<template>
  <div class="p-4 space-y-6">
    <div class="space-y-1">
      <h1 class="text-xl font-semibold">About Lik</h1>
      <p class="text-sm text-muted-foreground">Encrypted, real-time scoreboards over Nostr · v{{ version }}</p>
    </div>
    <a href="https://github.com/devforth/lik" target="_blank" rel="noopener" class="block text-sm underline underline-offset-4">
      Open source on GitHub (MIT)
    </a>
    <a href="https://devforth.io" target="_blank" rel="noopener" class="flex items-center gap-2 text-sm text-muted-foreground">
      <svg viewBox="0 0 251 232" class="h-4 w-auto text-foreground" aria-hidden="true">
        <path d="M230.716 87.638H167.124V116.673H230.716V87.638Z" fill="#48C5FF" />
        <path fill="currentColor" d="M198.243 30.098C212.714 30.004 227.312 33.305 239.425 41.448L250.245 13.467C234.514 3.30799 215.105 0 196.665 0C179.812 0.051 165.341 2.94799 153.33 8.62399C128.076 20.599 115.894 44.457 115.894 71.804V149.13C115.894 165.083 117.077 179.117 104.972 191.273C101.183 195.036 96.742 197.925 91.641 199.965C86.583 201.954 80.994 202.992 74.968 202.992C68.986 202.992 63.481 201.954 58.423 199.965C53.365 197.925 48.967 195.036 45.178 191.273C41.44 187.475 38.543 182.932 36.425 177.617C34.359 172.293 33.305 166.284 33.262 159.674C33.305 153.065 34.359 147.047 36.425 141.731C38.542 136.417 41.44 131.873 45.178 128.067C55.457 117.884 66.215 116.675 79.357 116.675H99.013V87.64H76.168C55.911 87.64 36.134 93.606 21.251 107.802C14.521 114.231 9.327 121.792 5.632 130.596C1.937 139.391 0.043 149.07 0 159.674C0.043 170.278 1.937 180 5.632 188.795C9.327 197.59 14.522 205.203 21.251 211.675C27.981 218.139 35.902 223.111 45.006 226.626C54.11 230.149 64.098 231.949 74.967 232C85.966 231.949 96.038 230.149 105.185 226.626C114.383 223.111 122.304 218.139 129.034 211.675C147.139 194.144 150.2 172.61 150.2 148.417C150.2 122.846 150.2 97.342 150.2 71.804C150.2 58.165 154.203 47.828 162.261 40.737C170.27 33.656 182.28 30.141 198.243 30.098Z" />
      </svg>
      Made by DevForth
    </a>
  </div>
</template>

<script setup lang="ts">
import { version } from '../../package.json'
</script>
