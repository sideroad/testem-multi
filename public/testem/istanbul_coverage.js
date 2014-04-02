Testem.on("all-test-results", function () {
	if (window.__coverage__) {
		var xhr = (window.ActiveXObject) ? new ActiveXObject("Microsoft.XMLHTTP") : new XMLHttpRequest();
		xhr.open('POST', '/testem-please-store-coverage', false);
		xhr.setRequestHeader('Content-Type', 'application/json');

		var JSON = window.JSON || JSON2();
		xhr.send(JSON.stringify(window.__coverage__));
	}
})