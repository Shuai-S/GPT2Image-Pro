package main

import (
	"strings"
	"testing"
)

func TestIsCloudflareChallenge(t *testing.T) {
	cases := []struct {
		status int
		body   string
		want   bool
	}{
		{403, "<title>Just a moment...</title>", true},
		{503, "id=challenge-platform", true},
		{403, "cf-browser-verification", true},
		{200, "just a moment", false}, // 非 403/503 即便有特征串也不算
		{403, `{"detail":"unauthorized"}`, false},
	}
	for _, c := range cases {
		if got := isCloudflareChallenge(c.status, []byte(c.body)); got != c.want {
			t.Errorf("isCloudflareChallenge(%d,%q)=%v want %v", c.status, c.body, got, c.want)
		}
	}
}

func TestPlatformFromUA(t *testing.T) {
	cases := map[string]string{
		"Mozilla/5.0 (Windows NT 10.0) Chrome/148":            "Windows",
		"Mozilla/5.0 (X11; Linux x86_64) Chrome/148":          "Linux",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/148":  "macOS",
		"Mozilla/5.0 (Linux; Android 14) Chrome/148 Mobile":   "Android",
	}
	for ua, want := range cases {
		if got := platformFromUA(ua); got != want {
			t.Errorf("platformFromUA(%q)=%q want %q", ua, got, want)
		}
	}
}

func TestApplyClearanceHeaders(t *testing.T) {
	ua := "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
	h := map[string]string{"User-Agent": "old-edge", "Sec-Ch-Ua": `"Microsoft Edge";v="143"`}
	applyClearanceHeaders(h, ua)
	if h["User-Agent"] != ua {
		t.Errorf("UA 未覆盖: %q", h["User-Agent"])
	}
	if !strings.Contains(h["Sec-Ch-Ua"], `v="148"`) || strings.Contains(h["Sec-Ch-Ua"], "Edge") {
		t.Errorf("Sec-Ch-Ua 未按 UA 重建: %q", h["Sec-Ch-Ua"])
	}
	if h["Sec-Ch-Ua-Full-Version"] != `"148.0.0.0"` {
		t.Errorf("Full-Version 错: %q", h["Sec-Ch-Ua-Full-Version"])
	}
	if h["Sec-Ch-Ua-Platform"] != `"Linux"` {
		t.Errorf("Platform 错: %q", h["Sec-Ch-Ua-Platform"])
	}
}
