import { buildApp } from './app';
import { type Config, ConfigError, loadConfig } from './config';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const app = buildApp();
app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
