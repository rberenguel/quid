package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"strconv"
	"strings"
)

// QuantizedData holds the processed word vectors and metadata needed for de-quantization.
type QuantizedData struct {
	Words     []string  `json:"words"`
	Vectors   [][]int8  `json:"vectors"`
	Min       float64   `json:"min"`
	Max       float64   `json:"max"`
	Dimension int       `json:"dimension"`
}

// loadWordList reads a file of words (one per line) into a set for efficient lookup.
func loadWordList(filePath string) (map[string]bool, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	wordSet := make(map[string]bool)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		wordSet[strings.ToLower(scanner.Text())] = true
	}

	return wordSet, scanner.Err()
}

func main() {
	// 1. Check and parse command-line arguments
	if len(os.Args) != 4 {
		log.Fatalf("Usage: go run %s <path-to-glove-file> <path-to-words.txt> <num-words-to-keep>", os.Args[0])
	}
	inputFile := os.Args[1]
	filterFile := os.Args[2]
	numWords, err := strconv.Atoi(os.Args[3])
	if err != nil {
		log.Fatalf("Invalid number of words: %v", err)
	}

	// 2. Load the filter word list
	fmt.Printf("Loading filter words from %s...\n", filterFile)
	wordSet, err := loadWordList(filterFile)
	if err != nil {
		log.Fatalf("Failed to load word list: %v", err)
	}
	fmt.Printf("Loaded %d words into the filter set.\n", len(wordSet))

	// 3. Open the GloVe file
	file, err := os.Open(inputFile)
	if err != nil {
		log.Fatalf("Failed to open file: %s", err)
	}
	defer file.Close()

	fmt.Printf("Processing words from %s, keeping the first %d that are in the word list...\n", inputFile, numWords)

	// 4. First pass: Read vectors, filter them, and find global min/max
	scanner := bufio.NewScanner(file)
	words := make([]string, 0, numWords)
	vectors := make([][]float64, 0, numWords)
	minVal, maxVal := math.MaxFloat64, -math.MaxFloat64
	dimension := -1

	for len(words) < numWords && scanner.Scan() {
		line := scanner.Text()
		parts := strings.Fields(line)
		word := parts[0]

		// Check if the word is in our filter set
		if _, exists := wordSet[strings.ToLower(word)]; !exists {
			continue
		}

		if dimension == -1 {
			dimension = len(parts) - 1
		} else if len(parts)-1 != dimension {
			log.Printf("Skipping line with inconsistent vector dimension: %s", line)
			continue
		}

		vec := make([]float64, dimension)
		for i := 1; i < len(parts); i++ {
			val, err := strconv.ParseFloat(parts[i], 64)
			if err != nil {
				log.Printf("Could not parse float in line, skipping: %s", line)
				continue
			}
			if val < minVal {
				minVal = val
			}
			if val > maxVal {
				maxVal = val
			}
			vec[i-1] = val
		}
		words = append(words, word)
		vectors = append(vectors, vec)
	}

	if err := scanner.Err(); err != nil {
		log.Fatalf("Error scanning file: %v", err)
	}

	if len(words) == 0 {
		log.Fatal("No words were processed. The file might be empty, N is zero, or no words matched the filter.")
	}
	
	fmt.Printf("Found %d words. Vector dimension: %d.\n", len(words), dimension)
	fmt.Printf("Global value range: [%f, %f]\n", minVal, maxVal)

	// 5. Second pass: Quantize vectors to int8
	quantizedVectors := make([][]int8, len(vectors))
	valRange := maxVal - minVal

	for i, vec := range vectors {
		quantizedVec := make([]int8, dimension)
		for j, val := range vec {
			scaled := (val - minVal) / valRange
			quantized := int8(math.Round(scaled*254.0) - 127.0)
			quantizedVec[j] = quantized
		}
		quantizedVectors[i] = quantizedVec
	}
	fmt.Println("Quantization complete.")

	// 6. Prepare and write the output JSON file
	outputData := QuantizedData{
		Words:     words,
		Vectors:   quantizedVectors,
		Min:       minVal,
		Max:       maxVal,
		Dimension: dimension,
	}

	outputFile := inputFile + ".quantized.json"
	jsonData, err := json.Marshal(outputData)
	if err != nil {
		log.Fatalf("Failed to marshal JSON: %v", err)
	}

	err = os.WriteFile(outputFile, jsonData, 0644)
	if err != nil {
		log.Fatalf("Failed to write to file: %v", err)
	}

	fmt.Printf("Successfully wrote %d quantized word vectors to %s\n", len(words), outputFile)
}
