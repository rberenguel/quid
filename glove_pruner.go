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

func main() {
	// 1. Check and parse command-line arguments
	if len(os.Args) != 3 {
		log.Fatalf("Usage: go run %s <path-to-glove-file> <num-words-to-keep>", os.Args[0])
	}
	inputFile := os.Args[1]
	numWords, err := strconv.Atoi(os.Args[2])
	if err != nil {
		log.Fatalf("Invalid number of words: %v", err)
	}

	// 2. Open the GloVe file
	file, err := os.Open(inputFile)
	if err != nil {
		log.Fatalf("Failed to open file: %s", err)
	}
	defer file.Close()

	fmt.Printf("Processing the first %d words from %s...\n", numWords, inputFile)

	// 3. First pass: Read top N vectors and find global min/max
	scanner := bufio.NewScanner(file)
	words := make([]string, 0, numWords)
	vectors := make([][]float64, 0, numWords)
	minVal, maxVal := math.MaxFloat64, -math.MaxFloat64
	var dimension int

	for i := 0; i < numWords && scanner.Scan(); i++ {
		line := scanner.Text()
		parts := strings.Fields(line)
		word := parts[0]
		vecStr := parts[1:]

		if i == 0 {
			dimension = len(vecStr)
		} else if len(vecStr) != dimension {
			log.Printf("Warning: line %d has %d dimensions, expected %d. Skipping.", i+1, len(vecStr), dimension)
			continue
		}

		currentVec := make([]float64, dimension)
		for j, valStr := range vecStr {
			val, err := strconv.ParseFloat(valStr, 64)
			if err != nil {
				log.Printf("Warning: could not parse float on line %d, value '%s'. Skipping line.", i+1, valStr)
				continue
			}
			if val < minVal {
				minVal = val
			}
			if val > maxVal {
				maxVal = val
			}
			currentVec[j] = val
		}
		words = append(words, word)
		vectors = append(vectors, currentVec)
	}

	if err := scanner.Err(); err != nil {
		log.Fatalf("Error scanning file: %v", err)
	}

	if len(words) == 0 {
		log.Fatal("No words were processed. The file might be empty or N is zero.")
	}
	
	fmt.Printf("Found %d words. Vector dimension: %d.\n", len(words), dimension)
	fmt.Printf("Global value range: [%f, %f]\n", minVal, maxVal)

	// 4. Second pass: Quantize vectors to int8
	quantizedVectors := make([][]int8, len(vectors))
	valRange := maxVal - minVal

	for i, vec := range vectors {
		quantizedVec := make([]int8, dimension)
		for j, val := range vec {
			// Scale the value to the [0, 1] range
			scaled := (val - minVal) / valRange
			// Scale to [-127, 127] and convert to int8
			// We use 254 to map to the range and -127 to center it.
			quantized := int8(math.Round(scaled*254.0) - 127.0)
			quantizedVec[j] = quantized
		}
		quantizedVectors[i] = quantizedVec
	}
	fmt.Println("Quantization complete.")

	// 5. Prepare and write the output JSON file
	outputData := QuantizedData{
		Words:     words,
		Vectors:   quantizedVectors,
		Min:       minVal,
		Max:       maxVal,
		Dimension: dimension,
	}

	jsonData, err := json.Marshal(outputData) // Use Marshal for compact output
	if err != nil {
		log.Fatalf("Failed to marshal data to JSON: %v", err)
	}

	outputFile := strings.TrimSuffix(inputFile, ".txt") + ".quantized.json"
	err = os.WriteFile(outputFile, jsonData, 0644)
	if err != nil {
		log.Fatalf("Failed to write output file: %v", err)
	}

	fmt.Printf("Successfully created quantized file: %s\n", outputFile)
}
