import { Telegraf } from "telegraf";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fetch from "node-fetch";
import fs from "fs";
import tmp from "tmp";
import express from "express";

const token = process.env.BOT_TOKEN;
if (!token) { console.error("Set BOT_TOKEN"); process.exit(1); }

ffmpeg.setFfmpegPath(ffmpegPath);
const bot = new Telegraf(token);

// маленький веб-сервер, Koyeb любит слушать порт
const app = express();
app.get("/", (_, res) => res.send("krugets-bot alive"));
app.listen(process.env.PORT || 8080);

async function downloadToFile(url, filepath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const file = fs.createWriteStream(filepath);
  await new Promise((resolve, reject) => {
    res.body.pipe(file);
    res.body.on("error", reject);
    file.on("finish", resolve);
  });
}

bot.start((ctx) => ctx.reply("Скинь видео (≤ ~1 мин) — верну кругляш 🎥⭕️"));
bot.help((ctx) => ctx.reply("Пришли .mp4 (видео или документ) — обрежу до 640×640 и пришлю video note."));

bot.on(["video", "document"], async (ctx) => {
  const processing = await ctx.reply("Делаю кругляш…");
  try {
    const fileId = ctx.message.video?.file_id || ctx.message.document?.file_id;
    if (!fileId) return ctx.reply("Нужен .mp4 или видео");

    const fileUrl = await ctx.telegram.getFileLink(fileId);
    const src = tmp.tmpNameSync({ postfix: ".mp4" });
    const dst = tmp.tmpNameSync({ postfix: ".mp4" });

    await downloadToFile(String(fileUrl), src);

    await new Promise((resolve, reject) => {
      ffmpeg(src)
        .videoFilters([
          { filter: "crop", options: "min(iw,ih):min(iw,ih):(iw-min(iw,ih))/2:(ih-min(iw,ih))/2" },
          { filter: "scale", options: "640:640" },
          { filter: "setsar", options: "1" }
        ])
        .outputOptions([
          "-t", "59",
          "-r", "30",
          "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
          "-pix_fmt", "yuv420p", "-movflags", "+faststart",
          "-c:a", "aac", "-b:a", "96k"
        ])
        .on("end", resolve).on("error", reject).save(dst);
    });

    await ctx.replyWithVideoNote({ source: fs.createReadStream(dst) }, { length: 640 });

    fs.unlink(src, () => {}); fs.unlink(dst, () => {});
  } catch (e) {
    console.error(e);
    await ctx.reply("Не удалось обработать видео. Проверь MP4 и длительность ≤ 1 мин.");
  } finally {
    try { await ctx.deleteMessage(processing.message_id); } catch {}
  }
});

bot.launch();
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
