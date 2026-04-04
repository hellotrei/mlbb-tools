import adapterNode from "@sveltejs/adapter-node";
import adapterVercel from "@sveltejs/adapter-vercel";

const useNodeAdapter = process.env.SVELTEKIT_ADAPTER === "node";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: useNodeAdapter ? adapterNode() : adapterVercel()
  }
};

export default config;
