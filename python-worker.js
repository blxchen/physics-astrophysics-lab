// Runs the same standard-library Python module used by the local API and Actions.
import physicsSource from './backend/physics.py?raw';

const CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
let runtime;

async function python() {
  if (!runtime) {
    runtime = (async () => {
      const { loadPyodide } = await import(/* @vite-ignore */ `${CDN}pyodide.mjs`);
      const pyodide = await loadPyodide({ indexURL: CDN });
      pyodide.FS.mkdir('/pal');
      pyodide.FS.writeFile('/pal/physics.py', physicsSource);
      pyodide.runPython('import sys; sys.path.insert(0, "/pal"); from physics import Storm, simulate');
      return pyodide;
    })();
  }
  return runtime;
}

self.onmessage = async ({ data: { id, parameters } }) => {
  try {
    const pyodide = await python();
    pyodide.globals.set('parameters_json', JSON.stringify(parameters));
    const result = pyodide.runPython('import json; json.dumps(simulate(Storm.from_dict(json.loads(parameters_json))), allow_nan=False)');
    self.postMessage({ id, result: JSON.parse(result) });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
