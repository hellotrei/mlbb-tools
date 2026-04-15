process.env.API_EMBEDDED_SERVER = "0";
const appModule = await import("../dist/index.cjs");

const moduleExports = appModule as { default?: { vercelHandler?: unknown }; vercelHandler?: unknown };
const vercelHandler = moduleExports.vercelHandler ?? moduleExports.default?.vercelHandler;

if (typeof vercelHandler !== "function") {
  throw new Error("Vercel handler was not found in dist bundle.");
}

export default vercelHandler;
