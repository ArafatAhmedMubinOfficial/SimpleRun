// Pure ES5 preflight check so older Node runtimes (e.g. Ubuntu/Debian apt Node 12/14/16/18)
// print an actionable upgrade message instead of crashing with SyntaxError on modern JS.
var raw = (process.versions && process.versions.node) ? process.versions.node : "0.0.0";
var major = parseInt(raw.split(".")[0], 10) || 0;

if (major < 20) {
  console.error("");
  console.error("======================================================================");
  console.error(" SimpleTun requires Node.js v20+ (v22 LTS recommended).");
  console.error(" Detected Node.js version: v" + raw);
  console.error(" Distro packages (like Ubuntu/Debian 'apt install nodejs') often");
  console.error(" ship outdated Node v12/v18 that cannot parse modern ESM syntax.");
  console.error("----------------------------------------------------------------------");
  console.error(" Upgrade Node.js to v22 LTS:");
  if (process.platform === "win32") {
    console.error("   Windows:  winget install OpenJS.NodeJS.LTS");
  } else if (process.platform === "darwin") {
    console.error("   macOS:    brew install node@22");
  } else {
    console.error("   Linux (NodeSource Debian/Ubuntu):");
    console.error("     curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs");
    console.error("   Or portable Node 22 binary (any Linux distro):");
    console.error("     curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1");
  }
  console.error("======================================================================");
  console.error("");
  process.exit(1);
}
