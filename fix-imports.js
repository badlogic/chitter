import fs from "fs";
import path from "path";

function revertImportsInFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    // Adjusted regex to match both import and export statements for relative paths
    const updatedContent = content.replace(/(from|export \*)\s+(['"])(\..*?)\.js\2/g, "$1 $2$3$2");
    fs.writeFileSync(filePath, updatedContent, "utf8");
}

function processDirectory(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((dirent) => {
        const fullPath = path.join(directory, dirent.name);
        if (dirent.isDirectory()) {
            processDirectory(fullPath);
        } else if (dirent.isFile() && path.extname(dirent.name) === ".ts") {
            // Change here to .ts
            revertImportsInFile(fullPath);
        }
    });
}

// Update this to the directory you want to process
const directoryToProcess = "src"; // Change this to the root directory of your TS files
processDirectory(directoryToProcess);
