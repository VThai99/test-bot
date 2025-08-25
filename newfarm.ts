import sharp from "sharp";
import { findSubImagePosition } from "./image";
import {
  clickButtonWithText,
  getScreenshot,
  ocrScreenArea,
  runADBCommand,
  sleepRandom,
  touchScreen,
  sleep,
  // ocrTextWithRect,
  // findImagePosition,
  fetchAccountsFromGoogleSheets,
  updateAccountInSheet,
  convertSheetDataToAccounts,
} from "./utils";
import { readFileSync, promises as fsPromises } from "fs";
import console from "console";
// import path from "path";

const util = require("util");
const exec = util.promisify(require("child_process").exec);

const TOLERANCE = 65;
const AVATAR_IMAGE_PATH = "./imgs/mission1.jpg";
const adbOptions = "-e";
const DEFAULT_WAIT_TIME = 15000;
const DEFAULT_WAIT_TIME_LONG = 15000;
const ADB_PATH = "C:\\Program Files\\BlueStacks_nxt\\HD-Adb.exe";
const PLAYER_PATH = "C:\\Program Files\\BlueStacks_nxt\\HD-Player.exe";
const URL_APP = "com.farlightgames.samo.gp";
const URL_APP_VN = "com.farlightgames.samo.gp.vn";

let currentApp: string = URL_APP_VN;
const appObj = {
  funtab: URL_APP_VN,
  global: URL_APP,
};

const RESOURCE_BUTTONS = {
  gold: { x: 426, y: 639 },
  wood: { x: 630, y: 639 },
  ore: { x: 839, y: 639 },
  mana: { x: 1056, y: 639 },
};

const TROOP_BUTTONS: Record<string, { x: number; y: number }> = {
  troop1: { x: 934, y: 116 },
  troop2: { x: 990, y: 116 },
  troop3: { x: 1045, y: 116 },
  troop4: { x: 1104, y: 116 },
  troop5: { x: 1161, y: 116 },
};

var accountToRun: string[] = [];
var currentAccount: string = "";
var accountRunning: string = "";

async function killApp() {
  console.log("kill app");
  exec('taskkill /f /im "HD-Player.exe"');
}

async function startApp() {
  try {
    const res = await exec("tasklist");
    if (res.stdout.includes("HD-Player.exe")) {
      console.log("BlueStack is already running");
      return;
    }
    console.log("start app");
    exec(`"${PLAYER_PATH}"`);
    console.log("wait for simulator to start");
    await sleep(20000);
    console.log("connect to simulator");
    exec(`"${ADB_PATH}" connect 127.0.0.1:5555`);
    await sleep(10000);
  } catch (error) {
    console.error("Error starting simulator:", error);
    throw error;
  }
}

async function killGame(url: string) {
  console.log("kill game");
  await runADBCommand(adbOptions, `shell am kill ${url}`);
  await sleepRandom(1000);
  await runADBCommand(adbOptions, `shell am force-stop ${url}`);
}

async function scrollDown(startx: number, starty: number) {
  console.log("scroll down");
  await runADBCommand(
    adbOptions,
    `shell input swipe ${startx} ${starty} ${startx} ${
      starty - Math.round(100 + Math.random() * 20)
    }`
  );
  await sleepRandom(100);
}
async function findSubImageInCurrentScreen(imgPath: string, t = TOLERANCE) {
  const img = await getScreenshot(adbOptions);
  if (!img) {
    console.error("Could not get screenshot");
    await killApp();
    process.exit(1);
  }

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
async function waitForSubImage(imgPath: string, timeout: number) {
  const subImg = await sharp(imgPath)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const img = await getScreenshot(adbOptions);
    if (!img) {
      console.error("Could not get screenshot");
      await killApp();
      process.exit(1);
    }

    const result = findSubImagePosition(
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
      TOLERANCE
    );
    if (result !== null) {
      console.log("[waitForSubImage] found " + imgPath);
      return result;
    }

    const texts = await ocrScreenArea(adbOptions, {
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    });
    if (texts.some((t) => t.text === "Slide to complete the puzzle")) {
      await fsPromises.writeFile(
        "./isBotChecking.lock",
        "isBotChecking.lock",
        "utf-8"
      );
      console.log("isBotChecking.lock created");
      await sendAlerts(
        "Slide to complete the puzzle, please check the game",
        "app",
        new Error("Slide to complete the puzzle")
      );
      await flushAlerts();
      process.exit(0);
    }
    await sleep(1000);
  }
  // TIMEOUT REACHED - SUBIMAGE NOT FOUND
  console.error(
    `[waitForSubImage] Timeout: Could not find ${imgPath} after ${timeout}ms`
  );

  try {
    await sendAlerts(
      `Timeout waiting for image: ${imgPath}. Killing game and app.`,
      "app",
      new Error(`Timeout waiting for ${imgPath}`)
    );

    // Kill the game first
    await killGame(URL_APP);
    await killGame(URL_APP_VN);
    await sleepRandom(2000);

    // Then kill the app
    await killApp();
    await sleepRandom(2000);

    await flushAlerts();
  } catch (error) {
    console.error("Error during cleanup:", error);
  }

  // Exit the process
  process.exit(1);
}
let sendAlertsTimeout: ReturnType<typeof setTimeout> | null = null;
let sendMessageBatch: string[] = [];
async function sendDiscordMessage(message: string, err?: unknown) {
  const payload = {
    // the username to be displayed
    username: "bot-alerts",
    // contents of the message to be sent
    content: message,
    ...(err
      ? {
          embeds: [
            {
              fields: [
                {
                  name: "Error",
                  value: JSON.stringify(err),
                },
              ],
            },
          ],
        }
      : {}),
  };
  const res = await fetch(
    "https://discord.com/api/webhooks/1387655225472450600/NHmWc0xJ8olpGOMfwliw2wxnutcCH_6Luq4j3TbAfYCXAVTpznfxbroWAOgxZQwfI545",
    {
      method: "post",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  ).catch((err) => {
    console.error("Error sending alert", err);
  });
}
export async function sendAlerts(
  message: string,
  account: string,
  err?: unknown
) {
  if (err) {
    console.error(`[${account}] ${message}`, err);
  } else {
    console.log(`[${account}] ${message}`);
  }
  if (!err) {
    sendMessageBatch.push(`[${account}] - ${message}`);
    if (sendMessageBatch.length > 10) {
      await flushAlerts();
    }
    if (sendAlertsTimeout) {
      clearTimeout(sendAlertsTimeout);
    }
    sendAlertsTimeout = setTimeout(async () => {
      await flushAlerts();
    }, 30000);
    return;
  }

  await sendDiscordMessage(`[${account}] - ${message}`, err);
}
async function flushAlerts() {
  if (sendMessageBatch.length === 0) return;
  const messageBatch = sendMessageBatch.join("\n");
  sendMessageBatch = [];
  await sendDiscordMessage(messageBatch);
}
function waitForAvatarImage() {
  // return waitForSubImage(AVATAR_IMAGE_PATH, 60000);
  const to = setTimeout(() => {
    console.log("waitForReady click random");
    return touchScreen(adbOptions, 30, 35);
  }, 30000);
  return waitForSubImage(AVATAR_IMAGE_PATH, 60000).finally(() => {
    clearTimeout(to);
  });
}

async function startGame(url: string) {
  sendAlerts("start game", "app");
  await runADBCommand(
    adbOptions,
    `shell am start -n ${url}/com.harry.engine.MainActivity`
  );
  await sleepRandom(DEFAULT_WAIT_TIME);
  await waitForAvatarImage();
}
export type Troop = [
  name: string,
  resource: "wood" | "gold" | "ore" | "mana",
  troopNumber: number
];

export interface Account {
  email: string;
  enable: boolean;
  gatherProdRss: boolean;
  gatherClanRss: boolean;
  gatherDragonPoint: boolean;
  nextCheckTime: string;
  stats: {
    gold: string;
    wood: string;
    ore: string;
    mana: string;
    gems: string;
  };
  nextAutoGatherTime: string;
  troops: Troop[];
  type: string;
}

// const accounts = JSON.parse(readFileSync(ACCOUNT_FILE_PATH, "utf-8")) as Record<
//   string,
//   Account
// >;
let accounts: Record<string, Account> = {};

async function initializeAccounts() {
  try {
    console.log("Fetching accounts from Google Sheets...");
    const sheetData = await fetchAccountsFromGoogleSheets();
    sendAlerts("Fetching accounts from Google Sheets completed", "app");
    if (!sheetData || sheetData.length === 0) {
      sendAlerts("Warning: No data returned from Google Sheets.", "app");
      throw new Error("No data returned from Google Sheets.");
    }
    accounts = convertSheetDataToAccounts(sheetData);
    console.log(
      "Successfully converted sheet data to accounts object:",
      accounts
    );
  } catch (error) {
    console.error(
      "Could not initialize accounts from Google Sheets. Falling back to local file.",
      error
    );
    sendAlerts(
      "Could not initialize accounts from Google Sheets. Falling back to local file.",
      "app",
      error
    );
  }
}

async function clickTopLeftAvatar(account: string) {
  sendAlerts("clickTopLeftAvatar", account);
  return touchScreen(adbOptions, 35, 35);
}

async function clickSettingButton(account: string) {
  sendAlerts("clickSettingButton", account);
  return clickButtonWithText(
    adbOptions,
    "Sett",
    { x: 640, y: 100, width: 600, height: 600 },
    { x: 0, y: -50 }
  );
}
async function clickCharacterManagementButton(account: string) {
  sendAlerts("clickCharacterManagementButton", account);
  return clickButtonWithText(
    adbOptions,
    "Character",
    { x: 200, y: 100, width: 800, height: 600 },
    { x: 0, y: -50 }
  );
}
async function clickAccountButton(account: string) {
  sendAlerts("clickAccountButton", account);
  return clickButtonWithText(
    adbOptions,
    "Account",
    { x: 0, y: 0, width: 1280, height: 700 },
    { x: 0, y: -50 }
  );
}

async function clickSwitchAccountButton(account: string) {
  sendAlerts("clickSwitchAccountButton", account);
  return clickButtonWithText(adbOptions, "Switch Accounts", {
    x: 0,
    y: 0,
    width: 1280,
    height: 700,
  });
}

async function clickLoginButton(account: string) {
  sendAlerts("clickLoginButton", account);
  return clickButtonWithText(adbOptions, "Login", {
    x: 474,
    y: 272,
    width: 326,
    height: 178,
  });
}
async function sendEscKey(account: string) {
  sendAlerts("sendEscKey", account);
  await runADBCommand(adbOptions, "shell input keyevent 111");
}
async function guessCurrentAccountFromScreen() {
  const texts = await ocrScreenArea(adbOptions, {
    x: 95,
    y: 290,
    width: 500,
    height: 60,
  });
  console.log("guessCurrentAccountFromScreen texts", texts);
  for (const t of texts) {
    for (const key in accounts) {
      if (t.text.includes(key)) {
        sendAlerts("guessCurrentAccountFromScreen currentAccount=" + key, key);
        return key;
      }
    }
  }
  // const texts = await findImagePosition(
  //   adbOptions,
  //   `${path.resolve(__dirname, "./imgs/copy.png")}`
  // );

  // if (texts.isMatch) {
  //   await touchScreen(
  //     adbOptions,
  //     Math.round(texts.rect.x + texts.rect.width / 2),
  //     Math.round(texts.rect.y + texts.rect.height / 2)
  //   );
  //   await sleep(3000);
  //   const res = await exec(
  //     'powershell -command "Get-Clipboard"'
  //   );
  //   sendAlerts("guessCurrentAccountFromScreen currentAccount=" + res.stdout, res.stdout);
  //   return res.stdout;
  // }
  const allTexts = await ocrScreenArea(adbOptions, {
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
  if (
    !allTexts.some((t) => t.text.includes("Power Merits")) &&
    !allTexts.some((t) => t.text.includes("Lord")) &&
    !allTexts.some((t) => t.text.includes("Achievements"))
  ) {
    sendAlerts(
      "guessCurrentAccountFromScreen something wrong when start app view, please check",
      "app",
      new Error("something wrong when start app view")
    );
    throw new Error("something wrong when start app view");
  }
  return "";
}

async function switchEmail(account: string, targetEmail: string) {
  await clickSettingButton(account);
  await sleepRandom(DEFAULT_WAIT_TIME);
  await clickAccountButton(account);
  await sleepRandom(DEFAULT_WAIT_TIME);
  await clickSwitchAccountButton(account);
  await sleepRandom(DEFAULT_WAIT_TIME);

  sendAlerts("Click Dropdown", account);
  await touchScreen(adbOptions, 586, 315);
  await sleep(DEFAULT_WAIT_TIME);
  const texts = await ocrScreenArea(adbOptions, {
    x: 304,
    y: 327,
    width: 672,
    height: 284,
  });
  let accountTexts = texts.find((t) => t.text.includes(targetEmail));
  let retry = 0;
  while (!accountTexts && retry < 5) {
    sendAlerts("Retry to find accountTexts retry=" + retry, account);
    await scrollDown(640, 380);
    const texts = await ocrScreenArea(adbOptions, {
      x: 304,
      y: 327,
      width: 672,
      height: 284,
    });
    accountTexts = texts.find((t) => t.text.includes(targetEmail));
    retry++;
  }
  if (accountTexts) {
    sendAlerts("Click accountTexts" + JSON.stringify(accountTexts), account);
    await touchScreen(
      adbOptions,
      accountTexts.rect.x + accountTexts.rect.width / 2,
      accountTexts.rect.y + accountTexts.rect.height / 2
    );
    await sleep(DEFAULT_WAIT_TIME);
  } else {
    throw new Error("Cannot find account " + targetEmail);
  }

  await clickLoginButton(account);
  await waitForAvatarImage();
  await clickTopLeftAvatar(account);
  await sleep(DEFAULT_WAIT_TIME);
}

async function changeAccount(account: string, currentAccount: string) {
  sendAlerts("switchAccount " + account, currentAccount);
  let currentAccount1 = await guessCurrentAccountFromScreen();
  const currentEmail = accounts[currentAccount1]?.email;
  const targetEmail = accounts[account]?.email;
  const targetID = accounts[account].id;
  sendAlerts(
    "currentEmail=" + currentEmail + " targetEmail=" + targetEmail,
    currentAccount
  );
  if (currentAccount1 !== account && accountToRun.includes(currentAccount1)) {
    accountToRun.splice(accountToRun.indexOf(currentAccount1), 1);
    accountToRun.push(account);
    accountRunning = currentAccount1;
    sendEscKey(currentAccount);
    return;
  }
  if (
    accounts[account]?.type !== accounts[currentAccount]?.type &&
    currentAccount1 === account
  ) {
    sendEscKey(currentAccount);
    return;
  }
  let needSwitchCharacter = account !== currentAccount;
  if (currentEmail !== targetEmail) {
    await switchEmail(currentAccount, targetID);
    currentAccount1 = await guessCurrentAccountFromScreen();
    sleepRandom(DEFAULT_WAIT_TIME);
    sendAlerts("currentAccount1=" + currentAccount1, currentAccount);
    needSwitchCharacter = account !== currentAccount1;
  }

  if (needSwitchCharacter) {
    await clickSettingButton(currentAccount);
    await sleepRandom(DEFAULT_WAIT_TIME);
    await clickCharacterManagementButton(currentAccount);
    await sleepRandom(DEFAULT_WAIT_TIME);
    const texts = await ocrScreenArea(adbOptions, {
      x: 256,
      y: 137,
      width: 766,
      height: 434,
    });

    let characterText = texts.find((t) => t.text.includes(account));
    let retry = 0;
    while (!characterText && retry < 3) {
      sendAlerts("Retry to find accountTexts retry=" + retry, account);
      await scrollDown(640, 380);
      const texts = await ocrScreenArea(adbOptions, {
        x: 256,
        y: 137,
        width: 766,
        height: 434,
      });
      characterText = texts.find((t) => t.text.includes(account));
      retry++;
    }
    if (!characterText) {
      sendAlerts("Character not found", currentAccount);
      process.exit(1);
    }
    sendAlerts("Click " + account, currentAccount);
    console.log("Click characterText", characterText);
    await touchScreen(
      adbOptions,
      characterText.rect.x + characterText.rect.width / 2,
      characterText.rect.y + characterText.rect.height / 2
    );
    await sleep(DEFAULT_WAIT_TIME);
    sendAlerts("Click confirm", currentAccount);
    await touchScreen(adbOptions, 745, 455);
    await sleep(DEFAULT_WAIT_TIME);
    await waitForAvatarImage();
  } else {
    await sendEscKey(currentAccount);
  }
}

// async function persistAccountSettings(account: string) {
//   await fsPromises.writeFile(
//     ACCOUNT_FILE_PATH,
//     JSON.stringify(accounts, null, 2),
//     "utf-8"
//   );
//   sendAlerts("Account settings saved", account);
// }

async function gatherProdRss(account: string) {
  sendAlerts("gatherProdRss", account);
  sendAlerts("Click mana", account);
  await touchScreen(adbOptions, 466, 436); // mana
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click stone", account);
  await touchScreen(adbOptions, 708, 261); // stone
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click gold", account);
  await touchScreen(adbOptions, 851, 360); // gold
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click wood", account);
  await touchScreen(adbOptions, 602, 537); // wood
  await sleep(DEFAULT_WAIT_TIME);
}
async function gatherClanRss(account: string) {
  sendAlerts("gatherClanRss", account);
  sendAlerts("Click bottom menu", account);
  await touchScreen(adbOptions, 1231, 664); // bottom menu
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click alliance", account);
  await touchScreen(adbOptions, 952, 667); // alliance
  await sleep(DEFAULT_WAIT_TIME);
  const texts = await ocrScreenArea(adbOptions, {
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
  if (
    texts.some((t) =>
      t.text.toLocaleLowerCase().includes("join an alliance now")
    )
  ) {
    sendAlerts("You have been kicked out of the alliance", account);
    await touchScreen(adbOptions, 14, 26); // close
    await sleep(DEFAULT_WAIT_TIME);
    return;
  }

  sendAlerts("Click territory", account);
  await touchScreen(adbOptions, 922, 445); // territory
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click claim", account);
  await touchScreen(adbOptions, 1093, 224); // Claim
  await sleep(DEFAULT_WAIT_TIME);
  await sendEscKey(account);
  await sleep(DEFAULT_WAIT_TIME);
  await sendEscKey(account);
  await sleep(DEFAULT_WAIT_TIME);
}
async function gatherDragonPoint(account: string) {
  sendAlerts("gatherDragonPoint", account);
  sendAlerts("Click campaign", account);
  await touchScreen(adbOptions, 861, 664); // Campaign
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click Behemoth trial", account);
  await touchScreen(adbOptions, 283, 316); // Behemoth trial
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click Exp", account);
  await touchScreen(adbOptions, 1210, 629); // Exp
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click claim", account);
  await touchScreen(adbOptions, 618, 515); // Claim
  await sleep(DEFAULT_WAIT_TIME);
  await sendEscKey(account);
  await sleep(DEFAULT_WAIT_TIME);
}

async function clickMagnifyingGlass(account: string) {
  sendAlerts("Click magnifying glass", account);
  await touchScreen(adbOptions, 45, 551); // magnifying glass
}

async function clickOnMap() {
  let pos = await findSubImageInCurrentScreen("./imgs/map.png", 65);
  if (pos !== null) {
    console.log("click map icon 1");
    await touchScreen(adbOptions, 48, 658);
    await sleep(DEFAULT_WAIT_TIME_LONG);
  }
  pos = await findSubImageInCurrentScreen("./imgs/map1.png", 20);
  if (pos !== null) {
    console.log("click map icon 2");
    await touchScreen(adbOptions, 48, 658);
    await sleep(DEFAULT_WAIT_TIME_LONG);
  }
  pos = await findSubImageInCurrentScreen("./imgs/map3.png", 20);
  if (pos !== null) {
    console.log("click map icon 3");
    await touchScreen(adbOptions, 48, 658);
    await sleep(DEFAULT_WAIT_TIME_LONG);
  }
}

async function gatherRss(
  rssName: "wood" | "gold" | "ore" | "mana",
  troopNumber: number,
  account: string
) {
  sendAlerts("gatherRss " + rssName, account);
  await clickOnMap();
  await clickMagnifyingGlass(account);
  await sleep(DEFAULT_WAIT_TIME);
  const button = RESOURCE_BUTTONS[rssName];
  if (button) {
    const texts = await ocrScreenArea(adbOptions, {
      x: 0,
      y: 0,
      width: 1200,
      height: 700,
    });
    const isSelected = texts.find(
      (t) => t.text.toLocaleLowerCase() === "more " + rssName + "."
    );
    if (!isSelected) {
      sendAlerts("Click " + rssName, account);
      await touchScreen(adbOptions, button.x, button.y);
      await sleep(DEFAULT_WAIT_TIME);
    }
    sendAlerts("Search Button", account);
    await touchScreen(adbOptions, button.x, button.y - 100);
    await sleep(DEFAULT_WAIT_TIME_LONG);

    sendAlerts("Click " + rssName + " node", account);
    await touchScreen(adbOptions, 640, 360);
    await sleep(DEFAULT_WAIT_TIME_LONG);

    sendAlerts("Click Gather", account);
    await touchScreen(adbOptions, 910, 520);
    await sleep(DEFAULT_WAIT_TIME_LONG);

    sendAlerts("Click Create Legions", account);
    await touchScreen(adbOptions, 1004, 148);
    await sleep(DEFAULT_WAIT_TIME_LONG);

    let _troopNumber = troopNumber;
    if (_troopNumber > 10) {
      sendAlerts("Click refresh troop ", account);
      await touchScreen(adbOptions, 1226, 119);
      await sleep(DEFAULT_WAIT_TIME);
    }
    if (_troopNumber > 20) {
      sendAlerts("Click refresh troop ", account);
      await touchScreen(adbOptions, 1226, 119);
      await sleep(DEFAULT_WAIT_TIME);
    }
    _troopNumber = _troopNumber % 10;

    sendAlerts("Click troop " + _troopNumber, account);
    const troopButton = TROOP_BUTTONS["troop" + _troopNumber];
    if (troopButton) {
      await touchScreen(adbOptions, troopButton.x, troopButton.y);
      await sleep(DEFAULT_WAIT_TIME);
    } else {
      throw new Error("Troop button not found");
    }
    sendAlerts("Click March", account);
    await touchScreen(adbOptions, 1034, 620);
  }
}
async function clickButtonIfFound(imgPath: string) {
  const btnPos = await findSubImageInCurrentScreen(imgPath);
  if (btnPos) {
    // console.log(
    //   "clickButton",
    //   btnPos,
    //   Math.round(btnPos.x + btnPos.width / 2),
    //   Math.round(btnPos.y + btnPos.height / 2)
    // );
    await sleep(1000);
    await touchScreen(
      adbOptions,
      Math.round(btnPos.x + btnPos.width / 2),
      Math.round(btnPos.y + btnPos.height / 2)
    );
    await sleep(1000);
  }
}
async function doFarm(account: string, currentAccount: string) {
  console.log("farm account", account);
  console.log("currentAccount", currentAccount);
  if (
    currentAccount != "" &&
    accounts[account].type !== accounts[currentAccount].type
  ) {
    await switchApp(account);
  }
  await changeAccount(account, currentAccount);
  await sleepRandom(DEFAULT_WAIT_TIME);
  const accountSettings = accounts[accountRunning];
  let minGatheringTime = new Date().getTime() + 1 * 60 * 60 * 1000;

  accountSettings.nextCheckTime = new Date(minGatheringTime).toISOString();
  const rssTexts = await ocrScreenArea(adbOptions, {
    x: 615,
    y: 0,
    width: 600,
    height: 40,
  });
  const rssObj = {
    gold: rssTexts[0]?.text || "",
    wood: rssTexts[1]?.text || "",
    ore: rssTexts[2]?.text || "",
    mana: rssTexts[3]?.text || "",
    gems: rssTexts[4]?.text || "",
  };

  await updateAccountInSheet(accountRunning, {
    stats: JSON.stringify(rssObj),
    nextCheckTime: accountSettings.nextCheckTime,
  });
  if (accountSettings.nextAutoGatherTime < new Date().toISOString()) {
    if (accountSettings.gatherProdRss) await gatherProdRss(accountRunning);
    if (accountSettings.gatherClanRss) await gatherClanRss(accountRunning);
    if (accountSettings.gatherDragonPoint)
      await gatherDragonPoint(accountRunning);
    accountSettings.nextAutoGatherTime = new Date(
      new Date().getTime() + 6 * 60 * 60 * 1000
    ).toISOString();
    // await persistAccountSettings(account);
    updateAccountInSheet(accountRunning, {
      stats: JSON.stringify(rssObj),
      nextCheckTime: accountSettings.nextCheckTime,
    });
  }
  sendAlerts("Click open queue list detail", accountRunning);
  await touchScreen(adbOptions, 1254, 290);
  await sleep(DEFAULT_WAIT_TIME);
  const texts = await ocrScreenArea(adbOptions, {
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
  sendAlerts("Click close queue list detail", accountRunning);
  await touchScreen(adbOptions, 154, 290);
  await sleep(DEFAULT_WAIT_TIME_LONG);
  for await (const troop of accountSettings.troops) {
    const [name, resource, troopNumber] = troop;
    const hasTroop = texts.find((t) =>
      t.text.toLocaleLowerCase().includes(name.toLocaleLowerCase())
    );
    if (hasTroop) {
      continue;
    }
    sendAlerts("Gather rss " + JSON.stringify(troop), accountRunning);
    await gatherRss(resource, troopNumber, accountRunning);
    await sleepRandom(DEFAULT_WAIT_TIME_LONG);
  }
  for (const t of texts) {
    if (t.text.startsWith("Gathering ") || t.text.startsWith("Returning ")) {
      const timeStr = t.text.split(" ")[1];
      const timeParts = timeStr.split(":");
      if (timeParts.length === 3) {
        const gatheringTime =
          (parseInt(timeParts[0]) * 60 * 60 +
            parseInt(timeParts[1]) * 60 +
            parseInt(timeParts[2])) *
            1000 +
          Date.now();

        if (gatheringTime < minGatheringTime) {
          minGatheringTime = gatheringTime;
        }
      }
    }
  }
  // only revisit after 1 hour to prevent ban
  accountSettings.nextCheckTime = new Date(
    Math.max(minGatheringTime, Date.now() + 3600 * 1000)
  ).toISOString();
  sendAlerts("nextCheckTime=" + accountSettings.nextCheckTime, accountRunning);
  updateAccountInSheet(accountRunning, {
    nextCheckTime: accountSettings.nextCheckTime,
  });
  await clickButtonIfFound("./imgs/btn_sickle.png");
  await clickButtonIfFound("./imgs/btn_help.png");
  await clickTopLeftAvatar(accountRunning);
  await sleepRandom(DEFAULT_WAIT_TIME);
  sendAlerts("done farm", accountRunning);
}

async function switchApp(account: string) {
  const app = accounts[account].type;
  const nameApp = currentApp === URL_APP ? "global" : "funtab";
  console.log("switch app from " + nameApp + " to " + app);
  sendAlerts("switch app from " + nameApp + " to " + app, account);
  try {
    await killGame(URL_APP);
    await killGame(URL_APP_VN);
    currentApp = appObj[app];
  } catch (e) {
    sendAlerts("kill game error", "app", e);
  }
  await sleepRandom(DEFAULT_WAIT_TIME);
  console.log("start game");
  await startGame(currentApp);
  await clickTopLeftAvatar(account);
  await sleep(DEFAULT_WAIT_TIME);
}

async function main() {
  await initializeAccounts();
  const isBotChecking = await fsPromises.exists("./isBotChecking.lock");
  if (isBotChecking) {
    await sendAlerts("isBotChecking.lock exists, exit", "app");
    await flushAlerts();
    process.exit(0);
  }
  accountToRun = Object.keys(accounts).filter((key) => {
    return (
      accounts[key].enable &&
      accounts[key].nextCheckTime < new Date().toISOString()
    );
  });
  if (accountToRun.length === 0) {
    sendAlerts("No account to run", "app");
    await flushAlerts();
    process.exit(0);
  }
  await startApp();
  sendAlerts("accountToRun" + JSON.stringify(accountToRun), "app");
  try {
    await killGame(URL_APP);
    await killGame(URL_APP_VN);
  } catch (e) {
    sendAlerts("kill game error", "app", e);
  }
  await sleepRandom(DEFAULT_WAIT_TIME);
  console.log("start game");
  const accType = appObj[accounts[accountToRun[accountToRun.length - 1]].type];
  currentApp = accType;
  await startGame(accType);

  await clickTopLeftAvatar("app");
  await sleepRandom(DEFAULT_WAIT_TIME);

  currentAccount = await guessCurrentAccountFromScreen();
  sendAlerts("currentAccount=" + currentAccount, "app");
  let accountToFarm = "";
  if (currentAccount === "" || !accountToRun.includes(currentAccount)) {
    accountToFarm = accountToRun.pop()!;
  } else {
    accountToFarm = currentAccount;
    // remove currentAccount from accountToRun
    accountToRun.splice(accountToRun.indexOf(currentAccount), 1);
  }
  sendAlerts("accountToFarm=" + accountToFarm, "app");
  accountRunning = accountToFarm;
  await doFarm(accountToFarm, currentAccount);
  currentAccount = await guessCurrentAccountFromScreen();
  while (accountToRun.length > 0) {
    sendAlerts("accountToRun" + JSON.stringify(accountToRun), "app");
    const nextAccount = accountToRun.pop()!;
    currentAccount = await guessCurrentAccountFromScreen();
    sleepRandom(DEFAULT_WAIT_TIME);
    accountRunning = nextAccount;
    await doFarm(nextAccount, currentAccount);
    if (!currentAccount) {
      currentAccount = nextAccount;
    }
  }
  sendAlerts("all accounts done", "app");

  const availableAccounts = Object.entries(accounts)
    .filter(([key, value]) => {
      return value.enable;
    })
    .sort((a, b) => {
      return (
        new Date(a[1].nextCheckTime).getTime() -
        new Date(b[1].nextCheckTime).getTime()
      );
    });

  sendAlerts(
    availableAccounts
      .map(
        (a) =>
          a[0] + " next check =" + new Date(a[1].nextCheckTime).toLocaleString()
      )
      .join("\n"),
    "app"
  );
  // const nextAccount = availableAccounts[0][0];

  // if (nextAccount && nextAccount !== currentAccount) {
  //   console.log("vao case nextAccount roiiiii");
  //   sendAlerts("nextAccount=" + nextAccount, "app");
  //   await changeAccount(nextAccount, currentAccount);
  //   await sleepRandom(DEFAULT_WAIT_TIME);
  // }
}

// run the script
await main();
await runADBCommand(adbOptions, "shell input keyevent KEYCODE_HOME");
await sleepRandom(DEFAULT_WAIT_TIME);
await killGame(currentApp);
await sleepRandom(DEFAULT_WAIT_TIME);
await killApp();
await flushAlerts();
process.exit(0);

