# Open the game in your default browser. No build step or server is needed.

UNAME := $(shell uname -s 2>/dev/null)

ifeq ($(OS),Windows_NT)
  OPEN := start ""
else ifeq ($(UNAME),Darwin)
  OPEN := open
else
  OPEN := xdg-open
endif

.PHONY: play
play:
	$(OPEN) index.html
