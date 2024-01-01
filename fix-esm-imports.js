import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function updateImportsInFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    // Regex now specifically targets relative paths starting with './' or '../'
    const updatedContent = content.replace(/from\s+(['"])(\.\/|\.\.\/)(.*?)(?<!\.js)\1/g, "from $1$2$3.js$1");
    fs.writeFileSync(filePath, updatedContent, "utf8");
}

function updateTsImports(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((dirent) => {
        const fullPath = path.join(directory, dirent.name);
        if (dirent.isDirectory()) {
            updateTsImports(fullPath);
        } else if (dirent.isFile() && path.extname(dirent.name) === ".ts") {
            updateImportsInFile(fullPath);
        }
    });
}

// Update this to the directory you want to process
const directoryToProcess = path.join(__dirname, "src");
updateTsImports(directoryToProcess);
