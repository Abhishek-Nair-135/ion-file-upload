import SparkMD5 from 'spark-md5';

export function generateFileHash(fileChunks) {
  const spark = new SparkMD5.ArrayBuffer();
  const fileReader = new FileReader();
  let chunkIndex = 0;
  let percentage = 0;
  let message;

  fileReader.onload = e => {
    const result = e.target?.result;
    spark.append(result);
    chunkIndex++;
    percentage += (1 / fileChunks.length) * 100;

    if (chunkIndex < fileChunks.length) {
      message = { percentage };
      
    // eslint-disable-next-line no-restricted-globals
      self.postMessage(message);
      loadNext();
    } else {
      message = { percentage: 100, hash: spark.end() };
      // eslint-disable-next-line no-restricted-globals
      self.postMessage(message);
    }
  };

  function loadNext() {
    fileReader.readAsArrayBuffer(fileChunks[chunkIndex]);
  }

  loadNext();
}