#!/usr/bin/env node
"use strict";
const esbuild = require("esbuild");
const glob = require("fast-glob");
const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const childProcess = require("child_process");

const isWatch = process.argv.findIndex((argItem) => argItem === "--watch") >= 0;
const isProduction = process.argv.findIndex((argItem) => argItem === "--production") >= 0;

const compilerOptions = {
    outdir: "dist",
    bundle: false,
    platform: "node",
    target: "esnext",
    format: "cjs",
    minify: isProduction,
};

const fixImportPaths = () => {
    const files = glob.sync("./dist/**/*.js");

    for (const file of files) {
        let content = fs.readFileSync(file, "utf8");
        const match = content.match(/"@\/.*"/g);

        if (match) {
            for (let foundPath of match) {
                const foundPathParsed = foundPath.replace(/"/g, "").replace("@/", `./${compilerOptions.outdir}/`);
                let newPath = path.relative(path.dirname(file), path.resolve(foundPathParsed)).replace(/\\/g, path.posix.sep);

                if (!newPath.startsWith(".")) {
                    newPath = "./" + newPath;
                }

                content = content.replace(foundPath, `"${newPath}"`);
            }
        }

        fs.writeFileSync(file, content);
    }
};

const files = glob.sync("./src/**/*.ts", {
    ignore: ["**.d.ts", "**/*.test.ts"],
});

(async () => {
    if (isWatch) {
        const watcher = chokidar.watch("./src/**/*.ts");
        let child = childProcess.fork("./dist/index.js");

        const onChange = async (file) => {
            const result = await esbuild.build({
                ...compilerOptions,
                entryPoints: [file],
                metafile: true,
                outdir: path.posix.join(compilerOptions.outdir, path.dirname(path.relative("./src", file).replace(/\\/g, path.posix.sep))),
            });

            if (result.errors.length === 0) {
                fixImportPaths();
                console.log(`File ${file} compiled successfully.`);
            } else {
                console.log(`File ${file} compilation failed.`);
            }
        };

        console.log("Watching for changes...");

        watcher.on("add", async (file) => {
            onChange(file);
            console.log(`File ${file} has been added to watch list.`);
        });

        watcher.on("change", async (file) => {
            onChange(file);

            if (!file.includes("commands")) {
                console.log("Stopping child process...");
                child.send("child_process:exit");
            }

            console.log(`File changed: ${file}`);
        });

        child.on("message", (message) => {
            if (message === "child_process:shutdown") {
                console.log("Starting new child process...");
                child = childProcess.fork("./dist/index.js");
            }
        });
    } else {
        await esbuild.build({
            ...compilerOptions,
            entryPoints: files,
        });

        fixImportPaths();
    }
})();
