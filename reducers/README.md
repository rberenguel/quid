# Generating the reduced models out of fastText

- Download the `cc.LANG.bin.gz` file, unzip it.
- Clone the repository, i.e. follow the steps in "binary" below.
- Build the `fastText` [binary](https://fasttext.cc/docs/en/support.html#building-fasttext-as-a-command-line-tool)
- Create a `uv` project and `uv add fasttext`.
- Run a dimensionality reduction with it. Will take a few minutes.
  - `uv run ft-repo/reduce_model.py cc.LANG.300.bin 50`
  - You could also write your own and avoid cloning, by just having `fasttext` added.
- Pipe the dictionary and text dumping
  - `./fasttext dump cc.LANG.50.bin dict | awk '{print $1}' | ./fasttext print-word-vectors cc.LANG.50.bin > cc.LANG.50.txt`
- Prune. You need a dictionary for the language, too.
  - `go run pruner.go cc.LANG.50.txt LANG.txt 50000`
