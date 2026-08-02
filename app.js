require("dotenv").config();
const cors = require('cors');
const express = require("express");
const multer = require("multer");
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { randomUUID } = require("crypto");
const path = require("path");

const app = express();
const PORT = 3000;

const allowedOrigin = [
  "http://127.0.0.1:5500",
  "/upload",
  "http://csc-alb-1199573466.eu-central-1.elb.amazonaws.com"
]

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigin.includes(origin)) {
      callback(null, true);
    }else {
      callback(new Error("origin not allowed"));
    }
  }
}))

const s3 = new S3Client({ 
    region: process.env.AWS_REGION,
    // credentials: {
    // accessKeyId: process.env.AWS_ACCESS_KEY,
    // secretAccessKey: process.env.AWS_SECRET_KEY,
  // },
 });
const BUCKET = process.env.S3_BUCKET;

const upload = multer({ storage: multer.memoryStorage() });
const post = [];

app.use(express.static("public"));


app.post("/upload", upload.single("photo"), async (req, res) => {
    console.log("Received upload request", req.file, req.body);
  try {
    const Unique = randomUUID() + "-" + req.file.originalname;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: Unique,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }),
    );
    post.unshift({ Unique, description: req.body.description || "" });
    res.status(201).json({ message: "uploaded to s3 successfuly" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.get("/health", (req, res) => res.status(200).send("ok"));

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`app is running on port ${PORT}`);
});
