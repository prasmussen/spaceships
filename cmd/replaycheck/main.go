package main

import (
	"spaceships/internal/replay"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"
)

func run() error {
	wasmPath := flag.String("wasm", "public/simulation.wasm", "matching WASM artifact")
	buildPath := flag.String("build", "public/build.json", "matching build manifest")
	flag.Parse()
	if flag.NArg() != 1 {
		return fmt.Errorf("usage: replaycheck [-wasm file] [-build file] replay.json")
	}
	wasm, err := os.ReadFile(*wasmPath)
	if err != nil {
		return err
	}
	manifest, err := os.ReadFile(*buildPath)
	if err != nil {
		return err
	}
	var identity replay.Identity
	if err = json.Unmarshal(manifest, &identity); err != nil {
		return err
	}
	file, err := os.Open(flag.Arg(0))
	if err != nil {
		return err
	}
	defer file.Close()
	recording, err := replay.Decode(file)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result, err := replay.Validate(ctx, wasm, identity, recording)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
