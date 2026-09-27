// Applies to the Remotion CLI (`npm run studio`, `npm run build`, `npx remotion render`).
// The worker passes equivalent options to @remotion/renderer programmatically.
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
Config.setCrf(20);
Config.setAudioCodec("aac");
Config.setPixelFormat("yuv420p");
Config.setOverwriteOutput(true);
