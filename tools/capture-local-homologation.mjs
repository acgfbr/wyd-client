import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const chromium = process.env.WYD_CHROMIUM
  ?? "/Applications/Chromium.app/Contents/MacOS/Chromium";
const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const output = path.resolve(process.argv[3] ?? "/tmp/wyd-homologation.png");
const width = Math.max(640, Number(process.argv[4] ?? 1024));
const height = Math.max(480, Number(process.argv[5] ?? 768));
const profile = `/tmp/wyd-homologation-${width}x${height}`;

await mkdir(profile, { recursive: true });
await unlink(path.join(profile, "DevToolsActivePort")).catch(() => undefined);
const browser = Bun.spawn([
  chromium,
  "--headless=new",
  "--no-first-run",
  "--disable-background-networking",
  "--enable-webgl",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--use-angle=swiftshader",
  "--hide-scrollbars",
  `--window-size=${width},${height}`,
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  url,
], {
  stdout: "ignore",
  stderr: "ignore",
});

const pending = new Map();
const runtimeErrors = [];
let socket;
let commandId = 0;

try {
  const port = await waitForDebugPort(profile);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const page = targets.find((target) => target.type === "page" && target.url.startsWith(url));
  if (!page?.webSocketDebuggerUrl) throw new Error("Aba do jogo não encontrada no Chromium");

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined) {
      const job = pending.get(message.id);
      if (!job) return;
      pending.delete(message.id);
      if (message.error) job.reject(new Error(message.error.message));
      else job.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails;
      const description = details?.exception?.description ?? details?.text ?? "Exceção sem descrição";
      const frame = details?.stackTrace?.callFrames?.[0];
      runtimeErrors.push(`${description}${frame?.url ? ` · ${frame.url}:${frame.lineNumber + 1}` : ""}`);
    }
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      const entry = message.params.entry;
      runtimeErrors.push(`${entry.text}${entry.url ? ` · ${entry.url}` : ""}`);
    }
  });

  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Log.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await waitUntil(async () => {
    const state = await evaluate(`(() => {
      const loading = document.querySelector("#loading");
      const skip = document.querySelector("#loading-cache-skip");
      if (skip && !skip.hidden) skip.click();
      return {
        ready: Boolean(loading?.classList.contains("is-hidden")),
        status: document.querySelector("#loading-status")?.textContent ?? "",
      };
    })()`);
    process.stdout.write(`\r[WYD] ${state.status.padEnd(55).slice(0, 55)}`);
    return state.ready;
  }, 120_000);

  await Bun.sleep(1_000);
  const state = await evaluate(`({
    loadingHidden: document.querySelector("#loading")?.classList.contains("is-hidden") ?? false,
    canvases: [...document.querySelectorAll("canvas")].map((canvas) => [
      canvas.id || canvas.className || "canvas",
      canvas.width,
      canvas.height,
    ]),
    viewport: [innerWidth, innerHeight],
    telemetry: document.querySelector("#runtime-telemetry")?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
  })`);
  const screenshot = await command("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await Bun.write(output, Buffer.from(screenshot.data, "base64"));
  process.stdout.write("\n");
  console.log(`[WYD] Captura salva em ${output}`);
  console.log(`[WYD] Estado: ${JSON.stringify(state)}`);
  if (runtimeErrors.length > 0) {
    console.log(`[WYD] Erros de runtime (${runtimeErrors.length}):`);
    for (const error of runtimeErrors) console.log(`- ${error}`);
    process.exitCode = 2;
  } else {
    console.log("[WYD] Erros de runtime: 0");
  }
} finally {
  socket?.close();
  browser.kill();
  await browser.exited;
}

async function waitForDebugPort(profileDirectory) {
  const file = path.join(profileDirectory, "DevToolsActivePort");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(file, "utf8")).trim().split(/\r?\n/);
      if (port && Number.isFinite(Number(port))) return Number(port);
    } catch {
      // Chromium writes the file after its browser process is ready.
    }
    await Bun.sleep(100);
  }
  throw new Error("Chromium não abriu a porta de depuração");
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(250);
  }
  throw new Error(`Homologação excedeu ${timeoutMs / 1_000}s`);
}
