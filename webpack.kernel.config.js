import path from "path";
import { fileURLToPath } from "url";
import { EsbuildPlugin } from "esbuild-loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default (env, argv) => {
    const production = argv.mode === "production";
    return {
        mode: argv.mode || "development",
        watch: !production,
        devtool: production ? false : "inline-source-map",
        entry: {
            "kernel": "./src/kernel.ts",
        },
        experiments: {
            outputModule: true,
        },
        output: {
            filename: "[name].js",
            path: path.resolve(__dirname),
            library: {
                type: "module",
            },
        },
        externals: {
            siyuan: "siyuan",
        },
        optimization: {
            minimize: production,
            minimizer: [
                new EsbuildPlugin({
                    target: "es2015",
                }),
            ],
        },
        resolve: {
            extensions: [".ts", ".js", ".json"],
        },
        module: {
            rules: [
                {
                    test: /\.ts(x?)$/,
                    include: [path.resolve(__dirname, "src")],
                    use: [
                        {
                            loader: "esbuild-loader",
                            options: {
                                target: "es2015",
                            },
                        },
                    ],
                },
            ],
        },
        plugins: [],
    };
};
