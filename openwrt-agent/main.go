// tokenrouter-agent fetches short-lived gateway config and atomically writes it
// for the local OpenWrt proxy. The DeepSeek master key never appears here.
package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Config struct {
	BaseURL   string `json:"base_url"`
	APIKey    string `json:"api_key"`
	ExpiresAt string `json:"expires_at"`
	Model     string `json:"model"`
}

func main() {
	controls, routerID, token := controlURLs(), os.Getenv("ROUTER_ID"), os.Getenv("ROUTER_CONTROL_TOKEN")
	if len(controls) == 0 || routerID == "" || token == "" {
		log.Fatal("CONTROL_URLS (or CONTROL_URL), ROUTER_ID and ROUTER_CONTROL_TOKEN are required")
	}
	out := os.Getenv("OUTPUT_FILE")
	if out == "" {
		out = "/etc/token-router/upstream.json"
	}
	interval := durationEnv("REFRESH_INTERVAL", 6*time.Hour)
	client := &http.Client{Timeout: durationEnv("HTTP_TIMEOUT", 20*time.Second)}
	log.Printf("tokenrouter-agent started: router_id=%s controls=%d refresh=%s output=%s", routerID, len(controls), interval, out)
	for {
		refreshed := false
		for _, control := range controls {
			if err := refresh(client, control, routerID, token, out); err != nil {
				log.Printf("control endpoint %s failed: %v", control, err)
				continue
			}
			refreshed = true
			break
		}
		if !refreshed {
			log.Printf("all control endpoints failed; retaining last valid gateway config")
		}
		time.Sleep(interval)
	}
}

func durationEnv(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < time.Second {
		log.Printf("invalid %s=%q; using %s", name, raw, fallback)
		return fallback
	}
	return d
}

func controlURLs() []string {
	raw := os.Getenv("CONTROL_URLS")
	if raw == "" {
		raw = os.Getenv("CONTROL_URL")
	}
	var urls []string
	for _, item := range strings.Split(raw, ",") {
		if item = strings.TrimSpace(item); item != "" {
			urls = append(urls, strings.TrimSuffix(item, "/"))
		}
	}
	return urls
}
func refresh(client *http.Client, control, id, token, out string) error {
	payload, _ := json.Marshal(map[string]string{"router_id": id})
	endpoint := strings.TrimSuffix(control, "/") + "/v1/router/config"
	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Router-Control-Token", token)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return &statusError{resp.Status}
	}
	var cfg Config
	if err = json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return err
	}
	raw, _ := json.Marshal(cfg)
	if err = os.MkdirAll(filepath.Dir(out), 0700); err != nil {
		return err
	}
	tmp := out + ".new"
	if err = os.WriteFile(tmp, raw, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, out)
}

type statusError struct{ s string }

func (e *statusError) Error() string { return e.s }
