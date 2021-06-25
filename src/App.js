import React, { useState, useEffect, useMemo } from "react";
import {
  Button,
  LinearProgress,
  Snackbar,
  Paper,
  AppBar,
  Toolbar,
  Typography,
  Container,
} from "@material-ui/core";
import { Alert } from "@material-ui/lab";
// eslint-disable-next-line import/no-webpack-loader-syntax
import createWorker from "workerize-loader!./worker";
import * as worker from "./worker";

const App = () => {
  const [UploadStatus, setUploadStatus] = useState({
    SUCCESS: 0,
    INITIAL: 1,
    PENDING: 2,
    PAUSED: 3,
    HASHING: 4,
  });
  const [file, setFile] = useState(null);
  const [fileHash, setFileHash] = useState(null);
  const [hashPercentage, setHashPercentage] = useState(0);
  const [fileChunks, setFileChunks] = useState([]);
  const [status, setStatus] = useState(UploadStatus.INITIAL);
  const [ongoingRequests, setOngoingRequests] = useState([]);
  const [open, setOpen] = useState(false);
  const [fakeTotalPercentage, setFakeTotalPercentage] = useState(0);

  const totalPercentage = useMemo(() => {
    if (status === UploadStatus.SUCCESS) {
      return 100;
    }

    if (!fileChunks.length || status === UploadStatus.INITIAL) {
      return 0;
    }

    const chunkUploadPercentage =
      fileChunks.reduce((total, chunk) => total + chunk.uploadPercentage, 0) /
      fileChunks.length;
    // fake merging time
    return chunkUploadPercentage - 5;
  }, [fileChunks, status]);

  const uploadDisabled = useMemo(
    () =>
      !file ||
      status === UploadStatus.PENDING ||
      status === UploadStatus.PAUSED ||
      status === UploadStatus.HASHING,
    [file, status]
  );

  useEffect(() => {
    if (status === UploadStatus.SUCCESS) {
      setOpen(true);
    }
  }, [status]);

  useEffect(() => {
    if (totalPercentage > fakeTotalPercentage || totalPercentage === 0) {
      setFakeTotalPercentage(totalPercentage);
    }
  }, [totalPercentage, fakeTotalPercentage]);

  return (
    <Paper elevation={0} style={{ padding: 0, margin: 0 }}>
      <AppBar color="primary" position="static">
        <Toolbar>
          <Typography color="inherit" variant="h6">
            Ion File Upload
          </Typography>
        </Toolbar>
      </AppBar>
      <Container style={{ padding: 16 }}>
        <input
          id="contained-button-file"
          type="file"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <label htmlFor="contained-button-file">
          <Button variant="contained" component="span" color="primary">
            choose file
          </Button>
        </label>
        <span>{file?.name}</span>
        <Container style={{ padding: 0, margin: "16px 0" }}>
          <Button
            variant="contained"
            color="primary"
            onClick={handleUpload}
            disabled={uploadDisabled}
            style={{ marginRight: 16 }}
          >
            Upload
          </Button>
        </Container>
        <Container style={{ padding: 0 }}>
          <div>hash progress: {Math.floor(hashPercentage)}%</div>
          <LinearProgress variant="determinate" value={hashPercentage} />
          <div>total progress: {Math.floor(fakeTotalPercentage)}%</div>
          <LinearProgress variant="determinate" value={fakeTotalPercentage} />
        </Container>
        {fileChunks.map((fileChunk) => (
          <Container key={fileChunk.chunkIndex} style={{ padding: 0 }}>
            <div>
              chunk - {fileChunk.chunkIndex}:{" "}
              {Math.floor(fileChunk.uploadPercentage)}%
            </div>
            <LinearProgress
              variant="determinate"
              value={fileChunk.uploadPercentage}
            />
          </Container>
        ))}
        <Snackbar
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          open={open}
          onClose={() => setOpen(false)}
          autoHideDuration={3000}
        >
          <Alert severity="success">File Uploaded Successfully!!</Alert>
        </Snackbar>
      </Container>
    </Paper>
  );

  function resetState() {
    setHashPercentage(0);
    setStatus(UploadStatus.INITIAL);
    setFileChunks([]);
  }

  async function handlePause() {
    if (status === UploadStatus.PAUSED) {
      const { uploadedChunks } = await verifyUpload(file.name, fileHash);
      await uploadChunks(file, fileHash, fileChunks, uploadedChunks);
    } else {
      setStatus(UploadStatus.PAUSED);
      ongoingRequests.forEach((xhr) => xhr?.abort());
    }
  }

  function handleFileChange(e) {
    const { files } = e.target;

    if (files) {
      setFile(files[0]);
    }

    resetState();
  }

  async function handleUpload() {
    if (!file) {
      alert("Please upload something!");
      return;
    }

    setStatus(UploadStatus.HASHING);
    const chunks = createFileChunks(file, 10);
    const fileHash = await createFileHash(chunks);
    setFileHash(fileHash);

    const { shouldUpload, uploadedChunks } = await verifyUpload(
      file.name,
      fileHash
    );

    if (!shouldUpload) {
      setStatus(UploadStatus.SUCCESS);
      return;
    }

    const fileChunk = chunks.map((chunk, index) => ({
      chunk,
      chunkIndex: index,
      chunkSize: chunk.size,
      uploadPercentage: uploadedChunks.includes(`${fileHash}-${index}`)
        ? 100
        : 0,
    }));
    setFileChunks(fileChunk);

    await uploadChunks(file, fileHash, fileChunk, uploadedChunks);
  }

  function createFileChunks(file, num) {
    const fileChunks = [];
    const chunkSize = Math.ceil(file.size / num);

    let size = 0;
    while (size < file.size) {
      fileChunks.push(file.slice(size, size + chunkSize));
      size += chunkSize;
    }

    return fileChunks;
  }

  function createFileHash(fileChunks) {
    return new Promise((resolve) => {
      const workerInstance = createWorker();
      workerInstance.generateFileHash(fileChunks);

      workerInstance.onmessage = function (e) {
        const { percentage, hash } = e.data;
        if (percentage) {
          setHashPercentage(percentage);
          if (hash) {
            resolve(hash);
          }
        }
      };
    });
  }

  async function uploadChunks(file, fileHash, chunksToUpload, uploadedChunks) {
    const requests = chunksToUpload
      .filter(
        (chunk) => !uploadedChunks.includes(`${fileHash}-${chunk.chunkIndex}`)
      )
      .map((chunk) => {
        const formData = new FormData();
        formData.append("fileName", file.name);
        formData.append("fileHash", fileHash);
        formData.append("chunkHash", `${fileHash}-${chunk.chunkIndex}`);
        formData.append("chunk", chunk.chunk);
        return futch({
          url: "http://localhost:1234/upload",
          data: formData,
          setOngoingRequests,
          onUploadProgress: (e) => handleUploadProgress(e, chunk.chunkIndex),
        });
      });

    setStatus(UploadStatus.PENDING);
    await Promise.all(requests);

    // merge
    await futch({
      url: "http://localhost:1234/merge",
      headers: { "content-type": "application/json" },
      data: JSON.stringify({ fileName: file.name, fileHash }),
    });
    setStatus(UploadStatus.SUCCESS);
  }

  function handleUploadProgress(e, chunkIndex) {
    const percentage = (e.loaded / e.total) * 100;

    setFileChunks((fileChunks) =>
      fileChunks.map((chunk) => {
        if (chunk.chunkIndex === chunkIndex) {
          return { ...chunk, uploadPercentage: percentage };
        } else {
          return chunk;
        }
      })
    );
  }

  async function verifyUpload(fileName, fileHash) {
    return await futch({
      url: "http://localhost:1234/verify",
      headers: { "content-type": "application/json" },
      data: JSON.stringify({ fileName, fileHash }),
    });
  }
};

export default App;

function futch(option) {
  const {
    url,
    method = "POST",
    headers,
    data,
    onUploadProgress,
    setOngoingRequests,
  } = option;

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => onUploadProgress?.(e);

    xhr.onload = () => {
      // remove finished xhr
      setOngoingRequests?.((ongoingRequests) =>
        ongoingRequests.filter((r) => r !== xhr)
      );

      try {
        resolve(JSON.parse(xhr.response));
      } catch (error) {
        resolve(xhr.response);
      }
    };

    xhr.open(method, url);

    if (headers) {
      Object.keys(headers).forEach((key) =>
        xhr.setRequestHeader(key, headers[key])
      );
    }

    xhr.send(data);

    // add xhr to ongoing request list
    setOngoingRequests?.((ongoingRequests) => [...ongoingRequests, xhr]);
  });
}
