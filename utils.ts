import sharp from "sharp";
import Tesseract from "tesseract.js";
import path from "path";
import { google } from 'googleapis';
import * as fs from "fs";
import { findSubImagePosition } from "./image";
import { sendAlerts, type Account } from "./newfarm";

const util = require("util");
const exec = util.promisify(require("child_process").exec);
// import tesseract from 'node-tesseract-ocr';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killApp() {
  console.log("kill app");
  sendAlerts("kill app", "app");
  exec('taskkill /f /im "HD-Player.exe"');
}

let adbTimeout: NodeJS.Timeout | null = null;

// Function to reset the timeout countdown
function resetTimeout() {
  if (adbTimeout) {
    clearTimeout(adbTimeout);
  }
  adbTimeout = setTimeout(async () => {
    console.log("ADB timeout: Killing app and exiting process...");
    await killApp();
    await sleep(5000);
    process.exit(0);
  }, 5 * 60 * 1000);
}

// Updated runADBCommand function
export async function runADBCommand(options: string, command: string) {
  resetTimeout(); // Reset the timeout countdown whenever this function is called

  const adbPath = "C:\\Program Files\\BlueStacks_nxt\\HD-Adb.exe";
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
): Promise<{
  isMatch: boolean;
  rect: { x: number; y: number; width: number; height: number };
}> => {
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
    return {
      isMatch: text.match,
      rect: {
        x: text.position.x,
        y: text.position.y,
        width: text.position.width,
        height: text.position.height,
      },
    };
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
  //   process.exit(0);
  for (const t of texts) {
    if (
      t.text.includes(text) &&
      t.rect.x < rect.x + rect.width &&
      t.rect.x + t.rect.width > rect.x &&
      t.rect.y < rect.y + rect.height &&
      t.rect.y + t.rect.height > rect.y
    ) {
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

// Ensure the timeout is cleared when the process exits
process.on("exit", () => {
  if (adbTimeout) {
    clearTimeout(adbTimeout);
  }
});

// fetchdatafromggsheet
const getSheetData = ({ sheetID, sheetName, query }: any): Promise<any> => {
  return new Promise((resolve, reject) => {
    const base = `https://docs.google.com/spreadsheets/d/${sheetID}/gviz/tq?`;
    const url = `${base}&sheet=${encodeURIComponent(
      sheetName
    )}&tq=${encodeURIComponent(query)}`;

    fetch(url)
      .then((res) => res.text())
      .then((response) => {
        const data = responseToObjects(response);
        resolve(data);
      })
      .catch((error) => {
        console.error("Error fetching sheet data:", error);
        reject(error); // Reject the Promise on error
      });

    function responseToObjects(res: any) {
      // credit to Laurence Svekis https://www.udemy.com/course/sheet-data-ajax/
      const jsData = JSON.parse(res.substring(47).slice(0, -2));
      let data = [];
      const columns = jsData.table.cols;
      const rows = jsData.table.rows;
      let rowObject;
      let cellData;
      let propName;
      for (let r = 0, rowMax = rows.length; r < rowMax; r++) {
        rowObject = {};
        for (let c = 0, colMax = columns.length; c < colMax; c++) {
          cellData = rows[r]["c"][c];
          propName = columns[c].label;
          if (cellData === null) {
            rowObject[propName] = "";
          } else if (
            typeof cellData["v"] == "string" &&
            cellData["v"].startsWith("Date")
          ) {
            rowObject[propName] = new Date(cellData["f"]);
          } else {
            rowObject[propName] = cellData["v"];
          }
        }
        data.push(rowObject);
      }
      return data;
    }
  });
};
export async function fetchAccountsFromGoogleSheets() {
  const dataRes = await getSheetData({
    sheetID: "1-8uVw0_c48oiFn-r5KFiDhFyvbtPM1KUrRQDspbQJlA",
    sheetName: "acc",
    // Use proper Google Sheets datetime format
    query: `SELECT * WHERE D = TRUE`,
  });
  return dataRes;
}

// update data to google sheets
// --- AUTHENTICATION (This part uses your new key file) ---
const auth = new google.auth.GoogleAuth({
  // Correct the path to your downloaded key file
  keyFile: './google-credentials.json', // IMPORTANT: Keep this file secure
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = "1-8uVw0_c48oiFn-r5KFiDhFyvbtPM1KUrRQDspbQJlA";
async function findAccountRow(accountName: string): Promise<number> {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'acc!A2:A', // Search only in the first column (account names)
    });
    const accountNames = response.data.values?.flat() || [];
    // Find the index. +1 because arrays are 0-indexed, +1 for the header row.
    const rowIndex = accountNames.indexOf(accountName);
    return rowIndex !== -1 ? rowIndex + 2 : -1;
  } catch (error) {
    console.error(`Error finding row for account ${accountName}: ${error.message}`);
    return -1;
  }
}
const columnMap: { [key: string]: string } = {
  'nextCheckTime': 'H',
  'nextAutoGatherTime': 'I',
  'stats': 'K',
}
/**
 * Updates specific columns for a given account in the Google Sheet.
 * This is the main function you will call from newfarm.ts.
 * @param accountName The name of the account to update.
 * @param data An object with the data to update, e.g., { H: 'new_time', J: 'new_stats' }
 */
export async function updateAccountInSheet(accountName: string, data: { [column: string]: any }) {
  const row = await findAccountRow(accountName);
  if (row === -1) {
    console.log(`Could not update sheet: Account "${accountName}" not found.`);
    return;
  }
  const updates = Object.entries(data).map(([column, value]) => ({
    range: `acc!${columnMap[column]}${row}`, // e.g., 'acc!H5'
    values: [[typeof value === 'object' ? JSON.stringify(value) : value]],
  }));

  if (updates.length === 0) return;

  try {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates,
      },
    });
    console.log(`✓ Google Sheet updated for account: ${accountName}`);
  } catch (error) {
    console.error(`Error batch updating sheet for ${accountName}: ${error.message}`);
  }
}

export function convertSheetDataToAccounts(sheetData: any[]): Record<string, Account> {
  if (!sheetData || sheetData.length === 0) {
    return {};
  }

  return sheetData.reduce((accountsObject, currentAccount) => {
    // Ensure the account has a name to be used as a key
    const accountName = currentAccount.name;
    if (!accountName) {
      return accountsObject; // Skip entries without a name
    }

    // Safely parse the 'troops' JSON string into an array
    let troops = [];
    if (typeof currentAccount.troops === 'string' && currentAccount.troops.trim() !== '') {
      try {
        troops = JSON.parse(currentAccount.troops);
      } catch (e) {
        console.error(`Error parsing troops for account ${accountName}:`, e);
        // Keep troops as an empty array on error
      }
    }

    // Safely parse the 'stats' JSON string into an object
    let stats = { gold: "", wood: "", ore: "", mana: "", gems: "" };
    if (typeof currentAccount.stats === 'string' && currentAccount.stats.trim() !== '') {
      try {
        const parsedStats = JSON.parse(currentAccount.stats);
        // Merge with default to ensure all keys exist
        stats = { ...stats, ...parsedStats };
      } catch (e) {
        console.error(`Error parsing stats for account ${accountName}:`, e);
      }
    }

    // Build the final account object in the desired format
    accountsObject[accountName] = {
      email: currentAccount.email || "",
      id: String(currentAccount.id || ""), // Ensure id is a string
      enable: currentAccount.enable === true || currentAccount.enable === 'TRUE',
      gatherProdRss: currentAccount.gatherProdRss === true || currentAccount.gatherProdRss === 'TRUE',
      gatherClanRss: currentAccount.gatherClanRss === true || currentAccount.gatherClanRss === 'TRUE',
      gatherDragonPoint: currentAccount.gatherDragonPoint === true || currentAccount.gatherDragonPoint === 'TRUE',
      nextCheckTime: currentAccount.nextCheckTime || new Date().toISOString(),
      nextAutoGatherTime: currentAccount.nextAutoGatherTime || new Date().toISOString(),
      troops: troops,
      stats: stats,
      type: currentAccount.type || 'funtab',
    };

    return accountsObject;
  }, {} as Record<string, Account>);
}