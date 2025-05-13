import sharp from "sharp";
import Tesseract from "tesseract.js";
import path from "path";

import * as fs from "fs";
import { findSubImagePosition } from "./image";

const util = require("util");
const exec = util.promisify(require("child_process").exec);
// import tesseract from 'node-tesseract-ocr';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runADBCommand(options: string, command: string) {
  const adbPath = "D:\\LDPlayer\\LDPlayer9\\adb";
  const fullCommand = `"${adbPath}" -s 127.0.0.1:5555 ${options} ${command}`;
  return exec(fullCommand);
}
export const sleepRandom = async (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms + Math.random() * 1000);
  });
};
export const ocrTextWithRect = async (
  imgPath: string
): Promise<
  {
    text: string;
    rect: { x: number; y: number; width: number; height: number };
  }[]
> => {
  try {
    const res = await exec(
      `py ${path.resolve(__dirname, "DetechTextByEasyOCR.py")} ${imgPath}`
    );
    const text = JSON.parse(res.stdout);
    // console.log("ocrTextWithRect", text);
    return text.items;
  } catch (e) {
    console.error(e);
  } finally {
  }
  return [];
};

export const captureScreen = async (adbOptions: string, outputFile: string) => {
  await runADBCommand(adbOptions, `exec-out screencap -p > "${outputFile}"`);
};
const tmpDir = path.resolve(__dirname, "./tmp");
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}
export async function getScreenshot(adbOptions: string) {
  const tmpFile = path.resolve(tmpDir, Date.now() + ".png");
  try {
    await captureScreen(adbOptions, tmpFile);
    const imgData = await sharp(tmpFile)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return imgData;
  } catch (e) {
    console.error(e);
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
}
export const ocrScreenArea = async (
  adbOptions: string,
  area: {
    x: number;
    y: number;
    width: number;
    height: number;
  }
) => {
  const tmpFile = path.resolve(tmpDir, Date.now() + ".png");
  const tmpFile1 = path.resolve(tmpDir, Date.now() + ".tmp.png");
  try {
    await captureScreen(adbOptions, tmpFile);

    await sleepRandom(1000);
    await sharp(tmpFile)
      .extract({
        left: area.x,
        top: area.y,
        width: area.width,
        height: area.height,
      })
      .toFile(tmpFile1);
    fs.renameSync(tmpFile1, tmpFile);

    const texts = await ocrTextWithRect(tmpFile);
    if (texts && texts.some((t) => t.text === "Slide to complete the puzzle")) {
      console.log("Slide to complete the puzzle");
      await fs.promises.writeFile(
        "./isBotChecking.lock",
        "isBotChecking.lock",
        "utf-8"
      );
      process.exit(0);
    }
    return texts.map((t) => {
      return {
        text: t.text,
        rect: {
          x: t.rect.x + area.x,
          y: t.rect.y + area.y,
          width: t.rect.width,
          height: t.rect.height,
        },
      };
    });
  } catch (e) {
    console.error(e);
  } finally {
    fs.unlinkSync(tmpFile);
  }
  return [];
};
export const findImagePosition = async (
  adbOptions: string,
  findImgPath: string
): Promise<
  {
    isMatch: boolean;
    rect: { x: number; y: number; width: number; height: number };
  }
> => {
  const tmpFile = path.resolve(tmpDir, Date.now() + ".png");
  try {
    await captureScreen(adbOptions, tmpFile);
    await sleepRandom(1000);

    const res = await exec(
      `py ${path.resolve(
        __dirname,
        "DetechImage.py"
      )} ${tmpFile} ${findImgPath}`
    );
    const text = JSON.parse(res.stdout);
    console.log("findPostion", text);
    return {
      isMatch: text.match,
      rect: {
        x: text.position.x,
        y: text.position.y,
        width: text.position.width,
        height: text.position.height,
      },
    }
  } catch (e) {
    console.error(e);
  } finally {
    fs.unlinkSync(tmpFile);
  }
  return {
    isMatch: false,
    rect: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    },
  };
};
export async function touchScreen(adbOptions: string, x: number, y: number) {
  return runADBCommand(
    adbOptions,
    `shell input tap ${x + Math.floor(5 - 10 * Math.random())} ${
      y + Math.floor(5 - 10 * Math.random())
    }`
  );
}
export async function clickButtonWithText(
  adbOptions: string,
  text: string,
  rect: { x: number; y: number; width: number; height: number },
  offset: { x: number; y: number } = { x: 0, y: 0 }
): Promise<boolean> {
  let texts = await ocrScreenArea(adbOptions, rect);
  // console.log("clickButtonWithText", texts);
  //   process.exit(0);
  for (const t of texts) {
    if (
      t.text === text &&
      t.rect.x < rect.x + rect.width &&
      t.rect.x + t.rect.width > rect.x &&
      t.rect.y < rect.y + rect.height &&
      t.rect.y + t.rect.height > rect.y
    ) {
      // console.log("clickButtonWithText", t);
      await touchScreen(
        adbOptions,
        t.rect.x + t.rect.width / 2 + offset.x,
        t.rect.y + t.rect.height / 2 + offset.y
      );
      return true;
    }
  }
  return false;
}
export async function checkImageExistedOnScreen(
  adbOptions: string,
  imgPaths: string[],
  t = 65
) {
  const img = await getScreenshot(adbOptions);
  if (!img) {
    throw new Error("Could not get screenshot");
  }
  for (const imgPath of imgPaths) {
    const subImg = await sharp(imgPath)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const results = findSubImagePosition(
      {
        width: img.info.width,
        height: img.info.height,
        data: new Uint8ClampedArray(img.data),
      },
      {
        width: subImg.info.width,
        height: subImg.info.height,
        data: new Uint8ClampedArray(subImg.data),
      },
      t
    );
    return results;
  }
  return null;
}
