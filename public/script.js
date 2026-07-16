// const { response } = require("express");

const dropzone   = document.getElementById('dropzone');
const fileInput  = document.getElementById('file-input');
const dzFilename = document.getElementById('dz-filename');


fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) dzFilename.textContent = fileInput.files[0].name;
});

['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });
});

['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
    });
});

dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) {
        fileInput.files = e.dataTransfer.files;
        dzFilename.textContent = file.name;
    }
});

document.getElementById('upload-form').addEventListener('submit', FileUpload);

async function FileUpload (event) {
    event.preventDefault();

    const formData = new FormData(event.target)
    dzFilename.textContent = "";
    console.log(formData);

    for (const [key, value] of formData.entries()) {
        console.log(key, value);
    }

    try {
        // const resp = await fetch(`${process.env.API_URL}/upload`, {
        const resp = await fetch(`http://127.0.0.1:3000/upload`, {
            method: "POST",
            body: formData
        });

        const data = await resp.json();

        if (!resp.ok) {
            console.error(data.error || "Upload failed");
            return;
        }

        event.target.reset();

    } catch (error) {
        console.error("cant upload to DB:", error);
    }
    
}
