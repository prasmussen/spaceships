package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"spaceships/internal/lobby"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func list(key, fallback string) []string {
	v := env(key, fallback)
	if v == "" {
		return nil
	}
	var result []string
	for _, part := range strings.Split(v, ",") {
		if part = strings.TrimSpace(part); part != "" {
			result = append(result, part)
		}
	}
	return result
}
func main() {
	static := env("STATIC_DIR", "dist")
	manifest, err := os.ReadFile(static + "/build.json")
	if err != nil {
		log.Fatal("build the frontend first: ", err)
	}
	var identity lobby.Identity
	if err = json.Unmarshal(manifest, &identity); err != nil {
		log.Fatal(err)
	}
	wasm, err := os.ReadFile(static + "/simulation.wasm")
	if err != nil {
		log.Fatal(err)
	}
	digest := sha256.Sum256(wasm)
	if hex.EncodeToString(digest[:]) != identity.WASM {
		log.Fatal("WASM artifact differs from build manifest; rebuild frontend")
	}
	hub, err := lobby.New(lobby.Config{TrustedProxyCIDRs: list("TRUSTED_PROXY_CIDRS", ""), Identity: identity, Origins: list("PUBLIC_ORIGINS", "http://127.0.0.1:8080,http://localhost:8080,http://127.0.0.1:5173,http://localhost:5173"), Regions: list("REGIONS", "eu"), STUNURLs: list("STUN_URLS", ""), TURNURLs: list("TURN_URLS", ""), TURNSecret: os.Getenv("TURN_SECRET"), StaticDir: static, MetricsToken: os.Getenv("METRICS_TOKEN")})
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go hub.Run(ctx)
	server := &http.Server{Addr: env("LISTEN_ADDR", "127.0.0.1:8080"), Handler: hub.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("Spaceships serving %s on %s", static, server.Addr)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
