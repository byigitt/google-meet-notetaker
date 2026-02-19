function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function log(module: string, message: string): void {
  console.log(`${ts()} [INFO] [${module}] ${message}`);
}

export function warn(module: string, message: string): void {
  console.warn(`${ts()} [WARN] [${module}] ${message}`);
}

export function error(module: string, message: string): void {
  console.error(`${ts()} [ERROR] [${module}] ${message}`);
}

export function debug(module: string, message: string): void {
  if (process.env.CLI_DEBUG !== '1') return;
  console.log(`${ts()} [DEBUG] [${module}] ${message}`);
}
