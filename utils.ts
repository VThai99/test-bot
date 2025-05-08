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
  const fullCommand = `"${adbPath}" ${options} ${command}`;
  return exec(fullCommand);
}
export const sleepRandom = async (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms + Math.random() * 1000);
  });
};

// export const ocrTextWithRect = async (
//   imgPath: string
// ): Promise<
//   {
//     text: string;
//     rect: { x: number; y: number; width: number; height: number };
//   }[]
// > => {
//   const metadata = await sharp(imgPath).metadata();
//   try {
//     const res = await exec(
//       `${path.resolve(
//         __dirname,
//         "./macos-vision-ocr-arm64 "
//       )} --img "${imgPath}" --rec-langs "en-US"`
//     );
//     const imgWidth = metadata.width as number;
//     const imgHeight = metadata.height as number;
//     const text = JSON.parse(res.stdout);
//     return text.observations.map(
//       (t: {
//         confidence: number;
//         quad: {
//           bottomLeft: { x: number; y: number };
//           topRight: { x: number; y: number };
//           bottomRight: { x: number; y: number };
//           topLeft: { x: number; y: number };
//         };
//         text: string;
//       }) => {
//         return {
//           text: t.text,
//           rect: {
//             x: Math.floor(t.quad.topLeft.x * imgWidth),
//             y: Math.floor(t.quad.topLeft.y * imgHeight),
//             width: Math.floor(
//               (t.quad.bottomRight.x - t.quad.topLeft.x) * imgWidth
//             ),
//             height: Math.floor(
//               (t.quad.bottomRight.y - t.quad.topLeft.y) * imgHeight
//             ),
//           },
//         };
//       }
//     );
//   } catch (e) {
//     console.error(e);
//   } finally {
//   }
//   return [];
// };

export const ocrTextWithRect = async (imgPath: string): Promise<any> => {
  console.log("imgpath", imgPath);
  const metadata = await sharp(imgPath).metadata();
  console.log("metadata", metadata);
  // const imgWidth = metadata.width as number;
//     const imgHeight = metadata.height as number;
  // const imageBuffer = await sharp(imgPath)
  // .resize({ width: imgWidth * 2 })  // or height * 2
  // .withMetadata({ density: 300 })
  // .toBuffer();
  try {
    const { createWorker } = Tesseract;
    const worker = await createWorker()
    await worker.setParameters({
      // tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
      user_defined_dpi: '100',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK, // auto
    });
    const {
      data
    } = await worker.recognize(
      imgPath,
      {},
      {
        text: true,
        blocks: true,
        layoutBlocks: true,
        hocr: false,
        tsv: false,
        box: false,
        unlv: false,
        osd: true,
        pdf: false,
        imageColor: false,
        imageGrey: false,
        imageBinary: false,
        debug: false,
      }
    );
    // console.log("data", JSON.stringify(data));
    const { paragraphs } = data.blocks?.[0];
    const { lines } = paragraphs[0];
    return lines.map(line => {
      const { text, bbox } = line;
      const { x0, y0, x1, y1 } = bbox;
      return {
        text,
        rect: {
          x: x0,
          y: y0,
          width: x1 - x0,
          height: y1 - y0,
        },
      };
    })
  } catch (e) {
    console.error("OCR Error:", e);
    return [];
  }
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
    // const metadata = await sharp(tmpFile).metadata();
    // console.log(metadata.width, metadata.height);
    // const clamp = (val, min, max) => Math.max(min, Math.min(val, max));

    // const safeArea = {
    //   left: clamp(area.x, 0, metadata.width - 1),
    //   top: clamp(area.y, 0, metadata.height - 1),
    //   width: clamp(area.width, 1, metadata.width - area.x),
    //   height: clamp(area.height, 1, metadata.height - area.y),
    // };
    // await sharp(tmpFile)
    // .extract(safeArea)
    // .toFile(tmpFile1);
    // extract area using sharp
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
      console.log("clickButtonWithText", t);
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
