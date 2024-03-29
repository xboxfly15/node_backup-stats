import { JSONFilePreset } from 'lowdb/node'
import express from 'express'
import { Transform } from 'node:stream'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import fastFolderSize from 'fast-folder-size'
const app = express()
const db = await JSONFilePreset('.db/stats.json', { })
const fastFolderSizeAsync = promisify(fastFolderSize)

const ipAddr = process.env.IP_ADDR || '0.0.0.0'
const port = process.env.PORT || 9002

const baseDir = path.join('A:', 'FTP', 'xboxfly15') // Path with backups

app.use((req, res, next) => {
  req.ipAddr = req.connection.remoteAddress
  req.ua = req.headers['user-agent']
  req.url = req.protocol + '://' + req.hostname + req.originalUrl
  logRequest(req)
  res.setHeader('Content-Type', 'text/html')
  res.setHeader('Cache-Control', 'private, max-age=3600')
  if (req.method === 'OPTIONS') return res.status(200).send()
  return next()
})

app.get('/', (req, res) => {
  res.status(200)

  const parser = new Transform()
  // This could be done better
  parser._transform = function(data, encoding, done) {
    let str = data.toString()
    str = str.replace('{JSON}', JSON.stringify(db))
    this.push(str)
    done()
  }

  const rs = fs.createReadStream(import.meta.dirname + '/index.html')
  rs.on('error', err => {
    res.send()
    console.error(err)
  })
  rs.pipe(parser).pipe(res)
})

app.listen(port, ipAddr, () => console.info(`Server started on ${ipAddr}:${port}`))

function logRequest(req) {
  console.log(`Request {\n  IP: ${req.ipAddr}\n  User agent: ${req.ua}\n  URL: ${req.url}\n}`)
}

async function getFolderPaths(dir) {
  let folders = await fs.promises.readdir(dir)
  folders = await Promise.all(folders.map(async folderName => {
    const folderPath = path.join(dir, folderName)
    const stats = await fs.promises.stat(folderPath)
    if (stats.isDirectory()) return folderPath
  }))

  return folders
}

async function updateStats() {
  console.log('Adding new backups')

  const nameFolders = await getFolderPaths(baseDir).then(folders => folders.map(path => { console.log(folders[path]); return getFolderPaths(folders[path]) }))
  const dateFolders = await nameFolders.map(async folder => await getFolderPaths(nameFolders[folder]))
  const folders = await dateFolders.map(async folder => await getFolderPaths(nameFolders[folder]))

  for (const folder in folders) {
    // Backup path style: UK1_MySQL_Backup\Fri_02-Apr-2021\12AM-BST
    const size = await fastFolderSizeAsync(folders[folder])
    const baseDirLen = baseDir.split(path.sep).length
    const [name, date, time] = folders[folder].split(path.sep).splice(baseDirLen).join(path.sep).split(path.sep) // Get "UK1_MySQL_Backup" from backup path
    const datetime = date + path.sep + time // Get date "Fri_02-Apr-2021" and time "12AM-BST" from backup path

    console.log(folder, size)
    if (!db[name]) {
      db[name] = {}
    }

    if (!db[name][datetime]) {
      db[name][datetime] = size
    }
  }

  db.write()
  console.log('Done')
}

setInterval(() => {
  updateStats()
}, 1000 * 60 * 10) // 10 minutes
updateStats()
