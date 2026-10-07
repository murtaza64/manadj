const assert = require("node:assert/strict");
const test = require("node:test");
const { ICON, menuTemplate, windowChromeOptions } = require("./chrome");

test("macOS chrome is unchanged: traffic lights, default menu", () => {
  assert.deepEqual(windowChromeOptions("darwin"), {
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 13 },
  });
  assert.equal(menuTemplate("darwin"), null);
});

for (const platform of ["win32", "linux"]) {
  test(`${platform} gets caption-button overlay, icon and a minimal menu`, () => {
    const options = windowChromeOptions(platform);
    assert.equal(options.titleBarStyle, "hidden");
    assert.equal(options.titleBarOverlay.height, 40);
    assert.equal(options.icon, ICON);
    assert.equal(options.trafficLightPosition, undefined);
    const accelerators = JSON.stringify(menuTemplate(platform));
    for (const bound of ["Ctrl+A", "Ctrl+Z", "Ctrl+F", "Ctrl+S", "Ctrl+G", "Ctrl+H", "Ctrl+L"]) {
      assert.ok(!accelerators.includes(`"${bound}"`), bound);
    }
    const roles = menuTemplate(platform)[0].submenu.map((item) => item.role).filter(Boolean);
    assert.deepEqual(roles, ["reload", "forceReload", "toggleDevTools", "togglefullscreen", "quit"]);
  });
}
