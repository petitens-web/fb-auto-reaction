# Bot Auto Reaction Feed/Home (beranda) Facebook(FB)
![Alt Text](https://github.com/IrsalHa/fb-auto-reaction/blob/main/pre.gif?raw=true)
<br>

## Local dashboard

Start the localhost-only dashboard and request-recording backend with:

```sh
npm start
```

Then open http://127.0.0.1:3000. The dashboard stores request records in
`data/activity.json`. It does not log in to social platforms or perform reactions, and
does not read or serve `appstate.json`. Keep account session files private.

The backend exposes `GET /api/activities` and `POST /api/requests` for listing and saving
request records. The server binds to `127.0.0.1` by default.

<hr>

<b>For Android<br>
How to install:</b><br>
`Open Termux`<br>
`1.pkg install git`<br>
`2.pkg install nodejs` <br>
`3.pkg install proot-distro`<br>
`4.proot-distro install alpine`<br>
`5.proot-distro login alpine`<br>
`6.apk update && apk add --no-cache nmap && \
  echo @edge http://nl.alpinelinux.org/alpine/edge/community >> /etc/apk/repositories && \
  echo @edge http://nl.alpinelinux.org/alpine/edge/main >> /etc/apk/repositories && \
  apk update && \
  apk add --no-cache \
  chromium`<br>
`7.git clone https://github.com/IrsalHa/fb-auto-reaction/ fb-auto-reaction`<br>
`8.cd fb-auto-reaction` <br>
`9.npm install`<br>
`10.node react` <br>
`11.FINISH`<br>
<hr>


<b>For Windows/Linux/Mac<br>
How to install:</b><br>
`Open Terminal / CMD`<br>
`1.Install NPM And Node Js` <br>
`2.git clone https://github.com/IrsalHa/fb-auto-reaction/ fb-auto-reaction`<br>
`3.cd fb-auto-reaction` <br>
`4.npm install`<br>
`5.node react `<br>
`6.FINISH`
<hr>

Tag:
#script #sourcecode #sc
https://irsalhakim10.medium.com/
