global.__basedir = __dirname
const app = require('express')()
app.disable('x-powered-by')
app.disable('etag')
const { Transform } = require('stream')

const ipAddr = process.env.IP_ADDR || '127.0.0.1'
const port = process.env.PORT || 9002

const lowdb = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const fileadapter = new FileSync('.db/stats.json')
const filedb = lowdb(fileadapter)
filedb.defaults({}).write()

const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const fastFolderSize = require('fast-folder-size')
const fastFolderSizeAsync = promisify(fastFolderSize)

const baseDir = path.join('A:', 'FTP', 'xboxfly15') // Path with backups

app.use((req, res, next) => {
  req.ipAddr = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress).split(':').pop()
  req.ua = req.headers['user-agent']
  req.lang = req.headers['accept-language']
  req.url = req.protocol + '://' + req.hostname + req.originalUrl
  logRequest(req)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, max-age=3600')
  if (req.originalUrl.length > 1000) return res.status(414).send()
  if (req.method === 'OPTIONS') return res.status(200).send()
  return next()
})

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.status(200)

  const parser = new Transform()
  // This could be done better
  parser._transform = function(data, encoding, done) {
    let str = data.toString()
    str = str.replace('{JSON}', JSON.stringify(getAllStats()))
    this.push(str)
    done()
  }

  const rs = fs.createReadStream(global.__basedir + '/index.html')
  rs.on('error', err => {
    res.send()
    console.error(err)
  })
  rs.pipe(parser).pipe(res)
})

app.listen(port, ipAddr, () => console.info(`Server started on ${ipAddr}:${port}`))

function logRequest(req) {
  console.log(`Request {\n  IP: ${req.ipAddr}\n  User agent: ${req.ua}\n  Browser language: ${req.lang}\n  URL: ${req.url}\n}`)
}

function getAllStats() {
  return filedb.value()
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

  const nameFolders = await getFolderPaths(baseDir)

  for (const nameFolder in nameFolders) {
    console.log(nameFolders[nameFolder])
    const dateFolders = await getFolderPaths(nameFolders[nameFolder])

    for (const dateFolder in dateFolders) {
      const timeFolders = await getFolderPaths(dateFolders[dateFolder])

      for (const timeFolder in timeFolders) {
        // Backup path style: UK1_MySQL_Backup\Fri_02-Apr-2021\12AM-BST
        const size = await fastFolderSizeAsync(timeFolders[timeFolder])
        const baseDirLen = baseDir.split(path.sep).length
        const folder = timeFolders[timeFolder].split(path.sep).splice(baseDirLen).join(path.sep) // Remove baseDir from folder path
        const name = folder.split(path.sep)[0] // Get "UK1_MySQL_Backup" from backup path
        const datetime = folder.split(path.sep)[1] + path.sep + folder.split(path.sep)[2] // Get date "Fri_02-Apr-2021" and time "12AM-BST" from backup path

        console.log(folder, size)
        if (!filedb.has(name).value()) {
          filedb.set(name, {}).value()
        }

        if (!filedb.get(name).has(datetime).value()) {
          filedb.get(name).set(datetime, size).value()
        }
      }
    }
  }

  filedb.write()
  console.log('Done')
}

setInterval(() => {
  updateStats()
}, 1000 * 60 * 10) // 10 minutes
updateStats()
