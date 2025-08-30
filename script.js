const GLOVE_FILE_PATH = "./glove.6B.50d.txt.quantized.json";
const TOP_N_FOR_SECRET_WORD = 20000;

const appState = {
  words: [],
  vectors: [],
  wordMap: new Map(),
  secretWord: null,
  secretVector: null,
  minVal: 0,
  maxVal: 0,
  dimension: 0,
  guesses: [],
  wordSimilarities: [],
  top1000Indices: new Set(),
  isLoading: true,
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
const winWordEl = document.getElementById("win-word");
const winGuessesEl = document.getElementById("win-guesses");
const playAgainBtn = document.getElementById("play-again-btn");
const mainContent = document.getElementById("main-content");

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

async function initGame() {
  resetUI();
  mainContent.classList.add("md:grid-cols-1");
  await loadData();
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
  const secretWordIndex = Math.floor(Math.random() * TOP_N_FOR_SECRET_WORD);
  appState.secretWord = appState.words[secretWordIndex];
  appState.secretVector = dequantizedVectors[secretWordIndex];
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
  secretWordRankEl.textContent = secretWordIndex + 1; // Use frequency rank

  appState.isLoading = false;
  loadingScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  guessInput.focus();
}

async function loadData() {
  try {
    const response = await fetch(GLOVE_FILE_PATH);
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
    appState.words.forEach((word, index) => {
      appState.wordMap.set(word, index);
    });
  } catch (error) {
    loadingStatus.textContent =
      "Error loading data. Please check the file path and try again.";
    console.error(error);
  }
}

function handleGuess(e) {
  e.preventDefault();
  const word = guessInput.value.trim().toLowerCase();
  guessInput.value = "";
  if (!word || appState.isLoading) return;
  if (!appState.wordMap.has(word)) {
    showHint("Word not in dictionary.", "error");
    return;
  }
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
    top1000Indices: new Set(),
    wordSimilarities: [],
  });
  loadingScreen.classList.remove("hidden");
  gameScreen.classList.add("hidden");
  winScreen.classList.add("hidden");
  progressBar.style.width = "0%";
  loadingStatus.textContent = "Initializing...";
  hintText.textContent = "Enter a word to begin.";
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
playAgainBtn.addEventListener("click", initGame);
document.addEventListener("DOMContentLoaded", initGame);
