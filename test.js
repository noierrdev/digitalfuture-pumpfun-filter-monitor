require("dotenv").config()
const bs58=require("bs58")
const PRIVATE_KEY=process.env.PRIVATE_KEY;
const privateKey=bs58.decode(PRIVATE_KEY)
console.log(Uint8Array.from(privateKey))

