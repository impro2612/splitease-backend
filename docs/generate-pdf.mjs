import puppeteer from 'puppeteer-core'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const chromePaths = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
]

const executablePath = chromePaths.find(p => existsSync(p))
if (!executablePath) {
  console.error('Chrome not found. Install Google Chrome.')
  process.exit(1)
}

console.log('Launching Chrome from:', executablePath)

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
})

const page = await browser.newPage()

const htmlPath = join(__dirname, 'splitease-docs.html')
await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' })

// Wait for fonts to load
await new Promise(r => setTimeout(r, 1000))

const outputPath = join(__dirname, 'SplitEase-Technical-Documentation.pdf')

await page.pdf({
  path: outputPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '15mm', bottom: '20mm', left: '15mm', right: '15mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `
    <div style="width:100%; font-size:9px; color:#94a3b8; padding:0 15mm; display:flex; justify-content:space-between; font-family:system-ui">
      <span>SplitEase — Technical Documentation</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
  `
})

await browser.close()
console.log('PDF generated:', outputPath)
