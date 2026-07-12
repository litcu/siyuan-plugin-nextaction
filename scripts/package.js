import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const outPath = path.join(projectRoot, "package.zip");

const requiredFiles = [
    "plugin.json",
    "index.js",
    "index.css",
    "kernel.js",
    "icon.png",
    "preview.png",
    "README.md",
    "README.zh-CN.md",
    "LICENSE",
    "i18n/en.json",
    "i18n/zh-CN.json",
];

function assertPackageReady() {
    const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(distDir, file)));
    if (missing.length > 0) {
        throw new Error(`Missing package files in dist/: ${missing.join(", ")}`);
    }
}

function collectFiles(dir, baseDir = dir) {
    const entries = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
            entries.push(...collectFiles(fullPath, baseDir));
        } else {
            const zipPath = path.relative(baseDir, fullPath).split(path.sep).join("/");
            entries.push({ fullPath, zipPath });
        }
    }
    return entries.sort((a, b) => a.zipPath.localeCompare(b.zipPath));
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c >>> 0;
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date = new Date()) {
    const year = Math.max(date.getFullYear(), 1980);
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { dosTime, dosDate };
}

function localHeader(entry) {
    const name = Buffer.from(entry.zipPath, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(entry.dosTime, 10);
    header.writeUInt16LE(entry.dosDate, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.size, 18);
    header.writeUInt32LE(entry.size, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    return Buffer.concat([header, name]);
}

function centralHeader(entry) {
    const name = Buffer.from(entry.zipPath, "utf8");
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(entry.dosTime, 12);
    header.writeUInt16LE(entry.dosDate, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.size, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    return Buffer.concat([header, name]);
}

function endRecord(fileCount, centralSize, centralOffset) {
    const header = Buffer.alloc(22);
    header.writeUInt32LE(0x06054b50, 0);
    header.writeUInt16LE(0, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(fileCount, 8);
    header.writeUInt16LE(fileCount, 10);
    header.writeUInt32LE(centralSize, 12);
    header.writeUInt32LE(centralOffset, 16);
    header.writeUInt16LE(0, 20);
    return header;
}

function writeZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { dosTime, dosDate } = dosTimestamp();

    for (const file of files) {
        const data = fs.readFileSync(file.fullPath);
        const entry = {
            ...file,
            data,
            size: data.length,
            crc: crc32(data),
            dosTime,
            dosDate,
            offset,
        };
        const local = localHeader(entry);
        localParts.push(local, data);
        offset += local.length + data.length;
        centralParts.push(centralHeader(entry));
    }

    const centralOffset = offset;
    const central = Buffer.concat(centralParts);
    const end = endRecord(files.length, central.length, centralOffset);
    fs.writeFileSync(outPath, Buffer.concat([...localParts, central, end]));
}

function main() {
    if (!fs.existsSync(distDir)) {
        throw new Error("dist/ not found. Run pnpm run build first.");
    }
    assertPackageReady();
    const files = collectFiles(distDir);
    writeZip(files);
    console.log(`Created package.zip with ${files.length} files.`);
}

main();
