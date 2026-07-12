import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const targetDir = "C:\\Users\\xavier\\Documents\\SiYuan\\Test\\data\\plugins\\nextaction";

const log = (msg) => console.log(`\x1B[36m%s\x1B[0m`, msg);
const error = (msg) => console.log(`\x1B[31m%s\x1B[0m`, msg);

function copyFile(src, dst) {
    if (!fs.existsSync(src)) {
        error(`  SKIP (not found): ${path.basename(src)}`);
        return false;
    }
    const dir = path.dirname(dst);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(src, dst);
    log(`  OK: ${path.basename(src)}`);
    return true;
}

function copyDirectory(srcDir, dstDir) {
    if (!fs.existsSync(srcDir)) {
        error(`  SKIP directory (not found): ${srcDir}`);
        return;
    }
    if (!fs.existsSync(dstDir)) {
        fs.mkdirSync(dstDir, { recursive: true });
    }
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const src = path.join(srcDir, entry.name);
        const dst = path.join(dstDir, entry.name);
        if (entry.isDirectory()) {
            copyDirectory(src, dst);
        } else {
            fs.copyFileSync(src, dst);
        }
    }
    log(`  OK: ${path.basename(srcDir)}/`);
}

function main() {
    log(">>> Deploying to SiYuan plugin directory...");

    const targetParent = path.dirname(targetDir);
    if (!fs.existsSync(targetParent)) {
        error(`Target parent directory not found: "${targetParent}"`);
        error("Please check the SiYuan workspace path in scripts/deploy.js");
        process.exit(1);
    }

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        log(`Created: ${targetDir}`);
    }

    // Determine build output directory (dev or dist)
    const isDev = process.env.NODE_ENV === "development" && fs.existsSync(path.join(projectRoot, "dev"));
    const buildDir = isDev ? "dev" : "dist";
    const buildPath = path.join(projectRoot, buildDir);

    if (!fs.existsSync(buildPath)) {
        error(`Build output not found: "${buildPath}"`);
        error('Run "pnpm run build" or "pnpm run dev" first');
        process.exit(1);
    }

    log(`Using build output: ${buildDir}/`);

    // Frontend bundle
    copyFile(path.join(buildPath, "index.js"), path.join(targetDir, "index.js"));
    copyFile(path.join(buildPath, "index.css"), path.join(targetDir, "index.css"));

    // Kernel bundle (production outputs to dist/, development outputs to project root)
    const kernelDist = path.join(buildPath, "kernel.js");
    const kernelRoot = path.join(projectRoot, "kernel.js");
    copyFile(fs.existsSync(kernelDist) ? kernelDist : kernelRoot, path.join(targetDir, "kernel.js"));

    // Static assets (vite-plugin-static-copy puts these in dist/)
    copyFile(path.join(buildPath, "plugin.json"), path.join(targetDir, "plugin.json"));
    copyFile(path.join(buildPath, "icon.png"), path.join(targetDir, "icon.png"));
    copyFile(path.join(buildPath, "preview.png"), path.join(targetDir, "preview.png"));

    // i18n (vite-plugin-static-copy puts it in dist/i18n/)
    const i18nDist = path.join(buildPath, "i18n");
    const i18nSrc = path.join(projectRoot, "src", "i18n");
    if (fs.existsSync(i18nDist)) {
        copyDirectory(i18nDist, path.join(targetDir, "i18n"));
    } else if (fs.existsSync(i18nSrc)) {
        copyDirectory(i18nSrc, path.join(targetDir, "i18n"));
    } else {
        error("  i18n directory not found");
    }

    log(">>> Deploy complete!");
}

main();
