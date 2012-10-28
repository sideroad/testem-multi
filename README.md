#testem-multi
Execute many testems and output one tap file.

##Install
```sh
npm install -g testem
npm install -g testem-multi
```

##Usage
1.Prepare testem-multi.json
```js
{
  "browsers" : [
    "chrome",
    "safari"
  ],
  "files" : [
    "examples/1.html",
    "examples/2.html"
  ]
}
```

2.Execute testem-multi
```sh
testem-multi
```
