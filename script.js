import { get, set, clear } from "./idb-keyval.js";
import { initHaptic, triggerHaptic, triggerHapticError } from "./haptic.js";

const TOP_N_FOR_SECRET_WORD = 20000;
const DIFFICULTY_LEVELS = {
  easy: 1000,
  medium: 10000,
  normal: 20000,
};

const LANGUAGES = {
  ca: {
    name: "Catalan",
    flag: "🇪🇸", // Note: No official Catalan flag emoji
    model: "./models/cc.ca.50.txt.quantized.json",
    replacements: [[/l·l/g, "ll"]],
  },
  de: {
    name: "German",
    flag: "🇩🇪",
    model: "./models/cc.de.50.txt.quantized.json",
    replacements: [
      [/ä/g, "a"],
      [/ö/g, "o"],
      [/ü/g, "u"],
      [/ß/g, "ss"],
    ],
  },
  en: {
    name: "English",
    flag: "🇬🇧",
    model: "./models/cc.en.50.txt.quantized.json",
    replacements: [],
  },
  es: {
    name: "Spanish",
    flag: "🇪🇸",
    model: "./models/cc.es.50.txt.quantized.json",
    replacements: [[/ñ/g, "n"]],
  },
  fr: {
    name: "French",
    flag: "🇫🇷",
    model: "./models/cc.fr.50.txt.quantized.json",
    replacements: [[/ç/g, "c"]],
  },
  it: {
    name: "Italian",
    flag: "🇮🇹",
    model: "./models/cc.it.50.txt.quantized.json",
    replacements: [],
  },
};

const appState = {
  words: [],
  vectors: [],
  wordMap: new Map(),
  normalizedWordMap: new Map(),
  secretWord: null,
  secretVector: null,
  secretWordRank: null,
  minVal: 0,
  maxVal: 0,
  dimension: 0,
  guesses: [],
  wordSimilarities: [],
  top1000Indices: new Set(),
  isLoading: true,
  currentGuess: "",
  isMobile: false,
  language: "ca",
  difficulty: "normal",
};

const loadingScreen = document.getElementById("loading-screen");
const gameScreen = document.getElementById("game-screen");
const winScreen = document.getElementById("win-screen");
const progressBar = document.getElementById("progress-bar");
const loadingStatus = document.getElementById("loading-status");
const guessForm = document.getElementById("guess-form");
const guessInput = document.getElementById("guess-input");
const latestGuessContainer = document.getElementById("latest-guess-container");
const hintText = document.getElementById("hint-text");
const latestGuessInfo = document.getElementById("latest-guess-info");
const latestWord = document.getElementById("latest-word");
const latestSimilarity = document.getElementById("latest-similarity");
const latestRank = document.getElementById("latest-rank");
const guessHistory = document.getElementById("guess-history");
const secretWordRankEl = document.getElementById("secret-word-rank");
const languageNameEl = document.getElementById("language-name");
const languageFlagEl = document.getElementById("language-flag");
const winWordEl = document.getElementById("win-word");
const winGuessesEl = document.getElementById("win-guesses");
const playAgainBtn = document.getElementById("play-again-btn");
const mainContent = document.getElementById("main-content");
const restartBtn = document.getElementById("restart-btn");
const virtualKeyboard = document.getElementById("virtual-keyboard");
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const languageSelect = document.getElementById("language-select");
const difficultySelect = document.getElementById("difficulty-select");

function showSettingsModal() {
  settingsModal.classList.remove("hidden");
}

function hideSettingsModal() {
  settingsModal.classList.add("hidden");
}

function populateLanguageSelector() {
  for (const [langCode, langData] of Object.entries(LANGUAGES)) {
    const option = document.createElement("option");
    option.value = langCode;
    option.textContent = langData.name;
    if (langCode === appState.language) {
      option.selected = true;
    }
    languageSelect.appendChild(option);
  }
}

async function saveGameState() {
  const stateToSave = {
    secretWord: appState.secretWord,
    guesses: appState.guesses,
    wordSimilarities: appState.wordSimilarities,
    language: appState.language,
    secretWordRank: appState.secretWordRank,
    difficulty: appState.difficulty,
  };
  await set("gameState", stateToSave);
}

async function loadGameState() {
  const savedState = await get("gameState");
  if (savedState) {
    appState.secretWord = savedState.secretWord;
    appState.guesses = savedState.guesses;
    appState.wordSimilarities = savedState.wordSimilarities;
    appState.language = savedState.language || "ca";
    appState.secretWordRank = savedState.secretWordRank;
    appState.difficulty = savedState.difficulty || "normal";
    languageSelect.value = appState.language;
    difficultySelect.value = appState.difficulty;
    return true;
  }
  return false;
}

async function restartGame() {
  triggerHapticError();
  await clear();
  resetUI();
  await initGame(true);
}

const KEYBOARD_LAYOUT = [
  "q w e r t y u i o p backspace",
  "a s d f g h j k l",
  "z x c v b n m enter",
];
function createKeyboard() {
  virtualKeyboard.innerHTML = "";
  KEYBOARD_LAYOUT.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "keyboard-row";
    row.split(" ").forEach((key) => {
      const keyEl = document.createElement("button");
      keyEl.className = "key";
      keyEl.dataset.key = key;
      if (key === "enter") {
        keyEl.innerHTML = '<i class="iconoir-upload"></i>';
        keyEl.classList.add("special-key");
      } else if (key === "backspace") {
        keyEl.innerHTML = '<i class="iconoir-transition-left"></i>';
        keyEl.classList.add("special-key");
      } else {
        keyEl.textContent = key;
      }
      rowEl.appendChild(keyEl);
    });
    virtualKeyboard.appendChild(rowEl);
  });
}
function updateGuessDisplay() {
  guessInput.value = appState.currentGuess;
}
function handleKeyPress(key) {
  if (appState.isLoading) return;
  if (key === "enter") {
    if (appState.currentGuess.length > 0) {
      guessForm.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  } else if (key === "backspace") {
    appState.currentGuess = appState.currentGuess.slice(0, -1);
  } else if (key.match(/^[a-z]$/) && appState.currentGuess.length < 20) {
    appState.currentGuess += key;
  }
  updateGuessDisplay();
}
function handlePhysicalKeyDown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key.match(/^[a-z]$/) || key === "enter" || key === "backspace") {
    e.preventDefault();
    handleKeyPress(key);
  }
}
function handleVirtualKeyboardClick(e) {
  triggerHaptic();
  const keyEl = e.target.closest(".key");
  if (keyEl) {
    handleKeyPress(keyEl.dataset.key);
  }
}
function setupInputMode() {
  appState.isMobile = window.matchMedia(
    "(max-width: 500px) and (orientation: portrait)",
  ).matches;
  if (appState.isMobile) {
    guessInput.readOnly = true;
    virtualKeyboard.classList.remove("hidden");
  } else {
    guessInput.readOnly = false;
    virtualKeyboard.classList.add("hidden");
  }
}

const dequantizeValue = (qVal) => {
  const { minVal, maxVal } = appState;
  const scaled = (qVal + 127) / 254.0;
  return scaled * (maxVal - minVal) + minVal;
};
const dequantizeVector = (quantizedVec) => quantizedVec.map(dequantizeValue);
const dotProduct = (vecA, vecB) => {
  let product = 0;
  for (let i = 0; i < vecA.length; i++) product += vecA[i] * vecB[i];
  return product;
};
const magnitude = (vec) => Math.sqrt(dotProduct(vec, vec));
const cosineSimilarity = (vecA, vecB) => {
  const magA = magnitude(vecA);
  const magB = magnitude(vecB);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(vecA, vecB) / (magA * magB);
};
async function initGame(forceNew = false) {
  initHaptic();
  resetUI();
  setupInputMode();
  mainContent.classList.add("md:grid-cols-1");

  // Determine language and difficulty from saved state or defaults
  const savedState = await get("gameState");
  if (!forceNew && savedState) {
    appState.language = savedState.language || "ca";
    appState.difficulty = savedState.difficulty || "normal";
  }
  languageSelect.value = appState.language;
  difficultySelect.value = appState.difficulty;
  languageNameEl.textContent = LANGUAGES[appState.language].name.toLowerCase();
  languageFlagEl.textContent = LANGUAGES[appState.language].flag;

  await loadData(appState.language);

  if (!forceNew && (await loadGameState())) {
    try {
      const secretWordIndex = appState.wordMap.get(appState.secretWord);
      if (secretWordIndex === undefined) throw new Error("Secret word not in map");
      appState.secretVector = dequantizeVector(
        appState.vectors[secretWordIndex],
      );
      appState.wordSimilarities.forEach((item, index) => {
        if (item.rank <= 1000) {
          appState.top1000Indices.add(index);
        }
      });
      secretWordRankEl.textContent = appState.secretWordRank;
      if (appState.guesses.length > 0) {
        updateLatestGuess(appState.guesses[0]);
      }
      renderGuessHistory();
      appState.isLoading = false;
      loadingScreen.classList.add("hidden");
      gameScreen.classList.remove("hidden");
      if (!appState.isMobile) guessInput.focus();
      return;
    } catch (err) {
      console.warn("Could not load saved game, starting a new one.", err);
      await clear(); // Clear corrupted saved state
    }
  }

  // This part runs for a new game (or if loading failed)
  const CHUNK_SIZE = 1000;
  loadingStatus.textContent = "Dequantizing word vectors...";
  progressBar.style.width = `0%`;
  await new Promise((resolve) => setTimeout(resolve, 10));

  const dequantizedVectors = [];
  for (let i = 0; i < appState.vectors.length; i += CHUNK_SIZE) {
    const chunk = appState.vectors.slice(i, i + CHUNK_SIZE);
    dequantizedVectors.push(...chunk.map(dequantizeVector));
    progressBar.style.width = `${(i / appState.vectors.length) * 50}%`;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  loadingStatus.textContent = "Choosing a secret word...";
  const topN = DIFFICULTY_LEVELS[appState.difficulty];
  const secretWordIndex = Math.floor(Math.random() * topN);
  appState.secretWord = appState.words[secretWordIndex];
  appState.secretVector = dequantizedVectors[secretWordIndex];
  appState.secretWordRank = secretWordIndex + 1;

  loadingStatus.textContent = "Calculating similarities...";
  await new Promise((resolve) => setTimeout(resolve, 10));

  const allSimilarities = [];
  for (let i = 0; i < dequantizedVectors.length; i += CHUNK_SIZE) {
    const chunk = dequantizedVectors.slice(i, i + CHUNK_SIZE);
    const chunkIndices = Array.from({ length: chunk.length }, (_, k) => i + k);
    const chunkSimilarities = chunk.map((vec, j) => ({
      index: chunkIndices[j],
      similarity: cosineSimilarity(appState.secretVector, vec),
    }));
    allSimilarities.push(...chunkSimilarities);
    progressBar.style.width = `${50 + (i / dequantizedVectors.length) * 45}%`;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  loadingStatus.textContent = "Finalizing...";
  progressBar.style.width = `95%`;
  await new Promise((resolve) => setTimeout(resolve, 10));

  allSimilarities.sort((a, b) => b.similarity - a.similarity);
  appState.wordSimilarities = new Array(appState.words.length);
  allSimilarities.forEach((item, rank) => {
    appState.wordSimilarities[item.index] = {
      similarity: item.similarity,
      rank: rank + 1,
    };
    if (rank < 1000) {
      appState.top1000Indices.add(item.index);
    }
  });

  progressBar.style.width = `100%`;
  secretWordRankEl.textContent = appState.secretWordRank;
  await saveGameState();

  appState.isLoading = false;
  loadingScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  if (!appState.isMobile) guessInput.focus();
}
const normalizeWord = (word) => {
  let normalized = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const langReplacements = LANGUAGES[appState.language].replacements;
  if (langReplacements) {
    for (const [regex, replacement] of langReplacements) {
      normalized = normalized.replace(regex, replacement);
    }
  }
  return normalized;
};

async function loadData(language) {
  try {
    const response = await fetch(LANGUAGES[language].model);
    const reader = response.body.getReader();
    const contentLength = +response.headers.get("Content-Length");
    let receivedLength = 0;
    let chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedLength += value.length;
      const progress = (receivedLength / contentLength) * 100;
      progressBar.style.width = `${progress}%`;
      loadingStatus.textContent = `Downloading... ${Math.round(progress)}%`;
    }
    let chunksAll = new Uint8Array(receivedLength);
    let position = 0;
    for (let chunk of chunks) {
      chunksAll.set(chunk, position);
      position += chunk.length;
    }
    const result = new TextDecoder("utf-8").decode(chunksAll);
    const data = JSON.parse(result);
    appState.words = data.words;
    appState.vectors = data.vectors;
    appState.minVal = data.min;
    appState.maxVal = data.max;
    appState.dimension = data.dimension;

    appState.wordMap.clear();
    appState.normalizedWordMap.clear();
    appState.words.forEach((word, index) => {
      appState.wordMap.set(word, index);
      appState.normalizedWordMap.set(normalizeWord(word), word);
    });
  } catch (error) {
    loadingStatus.textContent =
      "Error loading data. Please check the file path and try again.";
    console.error(error);
  }
}
function handleGuess(e) {
  e.preventDefault();
  const guessedWord = appState.currentGuess.trim().toLowerCase();
  appState.currentGuess = "";
  updateGuessDisplay();
  if (!guessedWord || appState.isLoading) return;

  const normalizedGuess = normalizeWord(guessedWord);
  if (!appState.normalizedWordMap.has(normalizedGuess)) {
    showHint("Word not in dictionary.", "error");
    return;
  }

  const word = appState.normalizedWordMap.get(normalizedGuess);

  if (appState.guesses.some((g) => g.word === word)) {
    showHint("You already guessed that word.", "info");
    return;
  }
  const wordIndex = appState.wordMap.get(word);
  const { similarity, rank } = appState.wordSimilarities[wordIndex];
  const guessData = { word, similarity, rank };
  appState.guesses.push(guessData);
  appState.guesses.sort((a, b) => b.similarity - a.similarity);
  updateLatestGuess(guessData);
  renderGuessHistory();
  saveGameState();
  if (word === appState.secretWord) {
    handleWin();
  }
}
function handleWin() {
  gameScreen.classList.add("hidden");
  winScreen.classList.remove("hidden");
  winWordEl.textContent = appState.secretWord;
  winGuessesEl.textContent = appState.guesses.length;
}
function resetUI() {
  Object.assign(appState, {
    guesses: [],
    secretWord: null,
    secretVector: null,
    secretWordRank: null,
    top1000Indices: new Set(),
    wordSimilarities: [],
    currentGuess: "",
  });
  updateGuessDisplay();
  loadingScreen.classList.remove("hidden");
  gameScreen.classList.add("hidden");
  winScreen.classList.add("hidden");
  progressBar.style.width = "0%";
  loadingStatus.textContent = "Initializing...";
  hintText.textContent = "Enter a word to begin.";
  hintText.classList.remove("hidden");
  latestGuessInfo.classList.add("hidden");
  guessHistory.innerHTML = "";
  guessInput.value = "";
}
function updateLatestGuess({ word, similarity, rank }) {
  hintText.classList.add("hidden");
  latestGuessInfo.classList.remove("hidden");
  latestWord.textContent = word;
  latestSimilarity.textContent = similarity.toFixed(4);
  latestRank.textContent = rank;
  const color = getHotnessColor(similarity);
  latestSimilarity.style.color = color;
  latestRank.style.color = color;
  const wordIndex = appState.wordMap.get(word);
  if (appState.top1000Indices.has(wordIndex) && word !== appState.secretWord) {
    latestRank.textContent += " (Top 1000!)";
  }
}
function renderGuessHistory() {
  guessHistory.innerHTML = "";
  appState.guesses.forEach((guess) => {
    const li = document.createElement("li");
    li.className = "guess-item";
    const color = getHotnessColor(guess.similarity);
    const wordSpan = document.createElement("span");
    wordSpan.textContent = guess.word;
    const similaritySpan = document.createElement("span");
    similaritySpan.className = "font-mono text-right";
    similaritySpan.textContent = (guess.similarity * 100).toFixed(2);
    similaritySpan.style.color = color;
    const rankSpan = document.createElement("span");
    rankSpan.className = "guess-rank text-right";
    rankSpan.textContent = guess.rank;
    rankSpan.style.color = color;
    const wordIndex = appState.wordMap.get(guess.word);
    if (
      appState.top1000Indices.has(wordIndex) &&
      guess.word !== appState.secretWord
    ) {
      li.classList.add("top-1000");
    }
    li.appendChild(wordSpan);
    li.appendChild(similaritySpan);
    li.appendChild(rankSpan);
    guessHistory.appendChild(li);
  });
}
function getHotnessColor(similarity) {
  if (similarity < 0.1) return "#60a5fa"; // blue-400
  if (similarity < 0.2) return "#38bdf8"; // lightBlue-400
  if (similarity < 0.3) return "#2dd4bf"; // teal-400
  if (similarity < 0.4) return "#34d399"; // emerald-400
  if (similarity < 0.5) return "#a3e635"; // lime-400
  if (similarity < 0.6) return "#facc15"; // yellow-400
  if (similarity < 0.7) return "#fb923c"; // orange-400
  if (similarity < 0.8) return "#f87171"; // red-400
  return "#ef4444"; // red-500
}
function showHint(message, type = "info") {
  hintText.textContent = message;
  hintText.classList.remove("hidden");
  latestGuessInfo.classList.add("hidden");
  if (type === "error") hintText.style.color = "#f87171";
  else hintText.style.color = "#9ca3af";
  setTimeout(() => {
    if (appState.guesses.length === 0)
      hintText.textContent = "Enter a word to begin.";
    else {
      hintText.classList.add("hidden");
      latestGuessInfo.classList.remove("hidden");
    }
  }, 2000);
}

guessForm.addEventListener("submit", handleGuess);
playAgainBtn.addEventListener("click", () => initGame(true));
restartBtn.addEventListener("click", () => {
  const newLang = languageSelect.value;
  const newDifficulty = difficultySelect.value;

  // Check if settings have changed
  if (
    newLang !== appState.language ||
    newDifficulty !== appState.difficulty
  ) {
    appState.language = newLang;
    appState.difficulty = newDifficulty;
  }

  hideSettingsModal();
  restartGame(); // This will start a new game with the updated settings
});
settingsBtn.addEventListener("click", showSettingsModal);
settingsModal
  .querySelector(".modal-backdrop")
  .addEventListener("click", hideSettingsModal);

document.addEventListener("DOMContentLoaded", () => {
  populateLanguageSelector();
  createKeyboard();
  initGame();
});
document.addEventListener("keydown", handlePhysicalKeyDown);
virtualKeyboard.addEventListener("click", handleVirtualKeyboardClick);
window.addEventListener("resize", setupInputMode);
