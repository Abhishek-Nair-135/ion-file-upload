const express = require("express");
var cors = require("cors");
var mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const JSONStream = require("JSONStream");
const Thermo = require("./models/thermometer");
const Busboy = require('busboy');
const uploadDir = path.resolve(__dirname, 'upload');

dotenv.config();

var mongoDBURI = process.env.MONGODB_DEV_URI;

mongoose.connect(mongoDBURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useFindAndModify: false,
  useCreateIndex: true,
});

mongoose.Promise = global.Promise;
var db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));

var app = express();

app.use(cors());
app.use(express.json({ extended: true }));

app.get("/load", (req, res) => {
  let observations = [];
  const dataStreamFromFile = fs.createReadStream(`${__dirname}/${req.query.file}`);

  dataStreamFromFile
    .pipe(JSONStream.parse("*"))
    .on("data", async (userData) => {
      observations.push(userData);
      if (observations.length === Number(process.env.BATCH_INSERT_VALUE)) {
        console.log("Obs: ", observations.length, observations[0]);
        dataStreamFromFile.pause();
        await Thermo.insertMany(observations);
        observations = [];
        console.log("Obs after: ", observations.length);
        process.stdout.write(".");
        dataStreamFromFile.resume();
      }
    });

  dataStreamFromFile.on("end", async () => {
    await Thermo.insertMany(observations); // left over data
    console.log("Import complete");
    res.json({
      message: "Data loaded successfully!!!",
    });
  });
});

app.post("/verify", async (req, res) => {
  const { fileName, fileHash } = req.body;
  const filePath = path.join(uploadDir, fileName);
  let data = { shouldUpload: false, uploadedChunks: [] };

  if (!fs.existsSync(filePath)) {
    const chunkDir = path.join(uploadDir, fileHash);
    const uploadedChunks = fs.existsSync(chunkDir)
      ? fs.readdirSync(chunkDir)
      : [];
    data.shouldUpload = true;
    data.uploadedChunks = uploadedChunks;
  }

  res.statusCode = 200;
  res.send(JSON.stringify(data));
});

app.post("/upload", (req, res) => {
  const busboy = new Busboy({ headers: req.headers });
  let fileName;
  let fileHash;
  let chunkHash;

  /**
   * 'filed' event is fired before 'file' event provided that
   * non-file filed is placed before file filed in FormData
   */
  busboy.on("field", (fieldname, val) => {
    if (fieldname === "fileName") {
      fileName = val;
    } else if (fieldname === "fileHash") {
      fileHash = val;
    } else if (fieldname === "chunkHash") {
      chunkHash = val;
    }
  });

  busboy.on("file", (_, file) => {
    const chunkDir = path.join(uploadDir, fileHash);
    const filePath = path.join(
      uploadDir,
      `${fileHash}${path.extname(fileName)}`
    );

    if (fs.existsSync(filePath)) {
      res.statusCode = 200;
      res.send("file already exists");
      return;
    }

    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    // save to system temp dir first, then move to upload dir
    const saveTo = path.join(chunkDir, chunkHash);
    const tmpSaveTo = path.join(__dirname,'tempp', chunkHash);
    const stream = fs.createWriteStream(tmpSaveTo);
    stream.on("finish", () => fs.renameSync(tmpSaveTo, saveTo));

    file.pipe(stream);
  });

  busboy.on("finish", () => {
    res.statusCode = 200;
    res.send("file chunk uploaded");
  });

  req.pipe(busboy);
});

app.post("/merge", async (req, res) => {
  const { fileName, fileHash } = req.body;
  const filePath = path.join(uploadDir, fileName);
  const chunkDir = path.join(uploadDir, fileHash);
  
  fs.readdirSync(chunkDir).forEach((chunk) => {
    const chunkPath = path.join(chunkDir, chunk);
    fs.appendFileSync(filePath, fs.readFileSync(chunkPath));
    fs.unlinkSync(chunkPath);
  });
  
  fs.rmdirSync(chunkDir);
  
  res.statusCode = 200;
  res.send("file chunks merged");
});

app.listen(1234, () => {
  console.log("Server is up and running on port number 1234");
});
