/*
 * NEVER / CONTROL — one-file Railway app; no dependencies.
 * Run: node index.js
 * Railway: set ADMIN_KEY to a private passphrase of at least 24 characters.
 * Generate a public domain; visit it, sign in, download the Lua client, run it.
 * Optional: attach a Railway Volume at /data to persist settings across deploys.
 * The game client requires executor HTTP + hook APIs used by the original script.
 * A normal Roblox LocalScript cannot perform this client-side HTTP integration.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULTS = Object.freeze({
  angle: 59, headEnabled: true, auraEnabled: false, radius: 20,
  barrierVisible: true, transparency: 0.9, interval: 0.2, debug: false,
});
function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('ข้อมูลไม่ถูกต้อง');
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw Error('Unknown setting: ' + key);
    if (typeof DEFAULTS[key] === 'boolean') {
      if (typeof value !== 'boolean') throw Error('Invalid boolean: ' + key);
    } else {
      const bounds = { angle: [0, 180], radius: [0, 5000], transparency: [0.5, 0.98], interval: [0.2, 2] }[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < bounds[0] || value > bounds[1]) throw Error('Invalid value: ' + key);
      if ((key === 'angle' || key === 'radius') && !Number.isInteger(value)) throw Error('Expected integer: ' + key);
    }
    out[key] = value;
  }
  return out;
}
const hash = value => crypto.createHash('sha256').update(String(value)).digest();
const sameSecret = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));

// JSON data is interpolated as Lua literals, never evaluated as code from the browser.
function gameClient(baseURL, deviceToken) {
  return `-- NEVER web client. Controls live on the website; no in-game panel.
local WEB_URL = ${JSON.stringify(baseURL)}
local DEVICE_TOKEN = ${JSON.stringify(deviceToken)}
local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local player = Players.LocalPlayer
assert(player, "Run Never on the client")
local requestFn = (syn and syn.request) or (http and http.request) or http_request or request
assert(type(requestFn) == "function", "Executor HTTP request API is required")

if _G.NeverWebRuntime and _G.NeverWebRuntime.stop then _G.NeverWebRuntime.stop() end
local playerGui = player:WaitForChild("PlayerGui")
local legacy = playerGui:FindFirstChild("NeverAngleUI")
if legacy then legacy:Destroy() end
local legacyHook = _G.NeverAngleCodeHook
if type(legacyHook) == "table" then legacyHook.gui = nil end
local runtime = {alive = true, connections = {}, workers = {}, targets = {}, connected = false}
_G.NeverWebRuntime = runtime
local config = {angle = 59, headEnabled = true, auraEnabled = false, radius = 20,
    barrierVisible = true, transparency = 0.9, interval = 0.2, debug = false}
local status = {found = 0, inRange = 0, message = "กำลังเชื่อมต่อ", hookAvailable = false}
local lastSync = 0
local deviceId = HttpService:GenerateGUID(false)
local barrier = Instance.new("SphereHandleAdornment")
barrier.Name = "NeverWebBarrier"
barrier.Color3 = Color3.fromRGB(180, 240, 220)
barrier.Transparency = config.transparency
barrier.Radius = config.radius
barrier.AlwaysOnTop = false
barrier.Visible = false
barrier.Parent = playerGui

local function connect(signal, callback)
    local connection = signal:Connect(callback)
    table.insert(runtime.connections, connection)
end
local function ownCharacter()
    local character = player.Character
    if character and character:IsDescendantOf(workspace) then return character end
    local named = workspace:FindFirstChild(player.Name)
    if named and named:IsA("Model") then return named end
    return nil
end
local function rootOf(model)
    if not model or not model:IsA("Model") then return nil end
    local root = model:FindFirstChild("HumanoidRootPart") or model.PrimaryPart
        or model:FindFirstChild("Torso") or model:FindFirstChild("UpperTorso") or model:FindFirstChild("Head")
    if root and root:IsA("BasePart") then return root end
    return nil
end
local function ownerOf(model)
    local owner = Players:GetPlayerFromCharacter(model)
    if owner then return owner end
    local named = Players:FindFirstChild(model.Name)
    if named and named:IsA("Player") then return named end
    return nil
end
local function addTarget(instance)
    if instance:IsA("Model") then runtime.targets[instance] = true end
end
connect(workspace.DescendantAdded, addTarget)
connect(workspace.DescendantRemoving, function(instance) runtime.targets[instance] = nil end)
for _, instance in ipairs(workspace:GetDescendants()) do addTarget(instance) end

local function refreshBarrier()
    local character = ownCharacter()
    local root = rootOf(character)
    local humanoid = character and character:FindFirstChildOfClass("Humanoid")
    barrier.Adornee = root
    if barrier.Radius ~= config.radius then barrier.Radius = config.radius end
    if barrier.Transparency ~= config.transparency then barrier.Transparency = config.transparency end
    local visible = runtime.connected and config.auraEnabled and config.barrierVisible
        and config.radius > 0 and root ~= nil and (not humanoid or humanoid.Health > 0)
    if barrier.Visible ~= visible then barrier.Visible = visible end
end

local function resolveRoot(target)
    if typeof(target) == "Instance" then
        if target:IsA("Player") then return rootOf(target.Character) end
        if target:IsA("Model") then return rootOf(target) end
        if target:IsA("BasePart") then return rootOf(target:FindFirstAncestorOfClass("Model")) or target end
    elseif type(target) == "string" then
        local named = workspace:FindFirstChild(target)
        if named and named:IsA("Model") then return rootOf(named) end
    end
end
local hitParts = {Head = true, HumanoidRootPart = true, Torso = true, UpperTorso = true, LowerTorso = true,
    LeftUpperArm = true, LeftLowerArm = true, LeftHand = true, RightUpperArm = true, RightLowerArm = true, RightHand = true,
    LeftUpperLeg = true, LeftLowerLeg = true, LeftFoot = true, RightUpperLeg = true, RightLowerLeg = true, RightFoot = true,
    ["Left Arm"] = true, ["Right Arm"] = true, ["Left Leg"] = true, ["Right Leg"] = true}
local function shouldUseHead(target, part)
    if not runtime.connected or not config.headEnabled or config.angle * 2 <= 10 then return false end
    if type(part) ~= "string" or not hitParts[part] then return false end
    local targetRoot = resolveRoot(target)
    local ownRoot = rootOf(ownCharacter())
    if not targetRoot or not ownRoot or targetRoot == ownRoot then return false end
    local delta = ownRoot.Position - targetRoot.Position
    local look = targetRoot.CFrame.LookVector
    local dm = math.sqrt(delta.X * delta.X + delta.Z * delta.Z)
    local fm = math.sqrt(look.X * look.X + look.Z * look.Z)
    if dm < 0.001 or fm < 0.001 then return false end
    local dx, dz, fx, fz = delta.X / dm, delta.Z / dm, look.X / fm, look.Z / fm
    local angle = math.deg(math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz))
    return math.abs(angle) <= config.angle + 0.0001
end

local hookState
if type(hookmetamethod) == "function" and type(newcclosure) == "function"
    and type(getnamecallmethod) == "function" and type(setnamecallmethod) == "function" then
    hookState = _G.NeverWebHook
    if type(hookState) ~= "table" then hookState = {}; _G.NeverWebHook = hookState end
    hookState.runtime = runtime
    hookState.shouldUseHead = shouldUseHead
    hookState.config = config
    hookState.auraSending = false
    if not hookState.installed then
        local state = hookState
        local old
        old = hookmetamethod(game, "__namecall", newcclosure(function(self, ...)
            local method = getnamecallmethod()
            if state.runtime and state.runtime.alive and method == "FireServer" and not state.auraSending then
                local target, part = ...
                local ok, useHead = false, false
                if target ~= "Use" then ok, useHead = pcall(state.shouldUseHead, target, part) end
                if ok and useHead then
                    local Args = table.pack(...)
                    Args[2] = "Head"
                    if state.config.debug then print("Arg 1:", Args[1]); print("Arg 2:", Args[2]) end
                    setnamecallmethod(method)
                    return old(self, table.unpack(Args, 1, Args.n))
                end
                setnamecallmethod(method)
            end
            return old(self, ...)
        end))
        hookState.installed = true
    end
    status.hookAvailable = true
end

local function sync()
    local response = requestFn({Url = WEB_URL .. "/api/device/sync", Method = "POST",
        Headers = {["Content-Type"] = "application/json", Authorization = "Bearer " .. DEVICE_TOKEN},
        Body = HttpService:JSONEncode({deviceId = deviceId, player = player.Name, status = status})})
    assert(response and response.StatusCode == 200, "Web connection failed")
    local body = HttpService:JSONDecode(response.Body)
    local nextConfig = body.config
    assert(type(nextConfig) == "table", "Invalid config")
    for key, value in pairs(nextConfig) do
        if typeof(value) == typeof(config[key]) then config[key] = value end
    end
    config.angle = math.clamp(math.floor(config.angle), 0, 180)
    config.radius = math.clamp(math.floor(config.radius), 0, 5000)
    config.interval = math.clamp(config.interval, 0.2, 2)
    config.transparency = math.clamp(config.transparency, 0.5, 0.98)
    _G.Left, _G.right = config.angle, config.angle
    _G.Kuy = config.headEnabled
    lastSync = os.clock()
    runtime.connected = true
    refreshBarrier()
end

local function auraTick()
    refreshBarrier()
    if not runtime.connected or not config.auraEnabled then status.message = "ปิด Kill Aura"; return end
    if config.radius == 0 then status.message = "ระยะ 0"; status.inRange = 0; return end
    local character = ownCharacter()
    local ownRoot = rootOf(character)
    local ownHumanoid = character and character:FindFirstChildOfClass("Humanoid")
    if not ownRoot or (ownHumanoid and ownHumanoid.Health <= 0) then status.message = "รอตัวละคร"; return end
    local bat = character:FindFirstChild("BaseballBat")
    local batScript = bat and bat:FindFirstChild("LocalScript")
    local Event = batScript and batScript:FindFirstChild("Damage")
    if not Event or not Event:IsA("RemoteEvent") then status.message = "ถือ BaseballBat"; return end
    local origin, radiusSquared = ownRoot.Position, config.radius * config.radius
    local batch, owners, found = {}, {}, {}
    for target in pairs(runtime.targets) do
        if target:IsDescendantOf(workspace) then
            local owner = ownerOf(target)
            if owner and owner ~= player and target ~= character then
                local root = rootOf(target)
                local head = target:FindFirstChild("Head")
                local humanoid = target:FindFirstChildOfClass("Humanoid")
                if root and head and head:IsA("BasePart") then
                    found[owner] = true
                    local delta = root.Position - origin
                    local distance = delta.X * delta.X + delta.Y * delta.Y + delta.Z * delta.Z
                    if (not humanoid or humanoid.Health > 0) and distance <= radiusSquared and not owners[owner] then
                        owners[owner] = true
                        table.insert(batch, {target = target, root = root, humanoid = humanoid, owner = owner})
                    end
                end
            end
        else runtime.targets[target] = nil end
    end
    local count = 0
    for _ in pairs(found) do count = count + 1 end
    status.found, status.inRange, status.message = count, #batch, "กำลังทำงาน"
    for _, entry in ipairs(batch) do
        task.defer(function(target, root, humanoid, owner)
            if not runtime.alive or not runtime.connected or not config.auraEnabled or config.radius <= 0
                or ownCharacter() ~= character or not target:IsDescendantOf(workspace)
                or owner.Parent ~= Players or not Event:IsDescendantOf(character)
                or (humanoid and humanoid.Health <= 0) then return end
            local delta = root.Position - ownRoot.Position
            if delta.X * delta.X + delta.Y * delta.Y + delta.Z * delta.Z > config.radius * config.radius then return end
            if hookState then hookState.auraSending = true end
            -- Adapted from the supplied Cobalt call: one Head request for each selected player.
            local ok, message = pcall(function() Event:FireServer(target, "Head") end)
            if hookState then hookState.auraSending = false end
            if not ok then status.message = "ส่งไม่สำเร็จ"; if config.debug then warn(message) end end
        end, entry.target, entry.root, entry.humanoid, entry.owner)
    end
end

function runtime.stop()
    if not runtime.alive then return end
    runtime.alive = false
    runtime.connected = false
    if hookState and hookState.runtime == runtime then hookState.runtime = nil end
    for _, thread in ipairs(runtime.workers) do pcall(task.cancel, thread) end
    for _, connection in ipairs(runtime.connections) do connection:Disconnect() end
    barrier:Destroy()
end
table.insert(runtime.workers, task.spawn(function()
    local failures = 0
    while runtime.alive do
        local ok = pcall(sync)
        if ok then failures = 0 else
            failures = failures + 1
            status.message = "เชื่อมเว็บไม่สำเร็จ"
            if os.clock() - lastSync > 10 then runtime.connected = false; barrier.Visible = false end
        end
        task.wait(math.min(5, failures + 1))
    end
end))
table.insert(runtime.workers, task.spawn(function()
    while task.wait(config.interval) do
        if not runtime.alive then break end
        if os.clock() - lastSync > 10 then runtime.connected = false; barrier.Visible = false end
        if runtime.connected then
            local ok, message = xpcall(auraTick, tostring)
            if hookState then hookState.auraSending = false end
            if not ok then status.message = "เกิดข้อผิดพลาด"; if config.debug then warn(message) end; task.wait(1) end
        end
    end
end))
print("Never: adjust controls at " .. WEB_URL)
`;
}

const PAGE = String.raw`<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Never / Control</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23131817'/%3E%3Cpath d='M18 46V18l28 28V18' fill='none' stroke='%239ee5c9' stroke-width='6'/%3E%3C/svg%3E">
<style>
:root{color-scheme:dark;--bg:#101413;--panel:#191f1c;--line:#303a34;--ink:#edf3ec;--muted:#a2b0a6;--green:#9ee5c9}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 'Segoe UI',Tahoma,sans-serif}button,input{font:inherit}button{cursor:pointer;border:1px solid var(--line);background:#222c26;color:var(--ink);border-radius:10px;padding:10px 16px}button:hover{border-color:var(--green)}button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--green);outline-offset:4px}button:disabled{opacity:.45;cursor:wait}.primary{background:var(--green);color:#15241b;border-color:var(--green);font-weight:650}input[type=password]{width:100%;background:#111713;border:1px solid var(--line);border-radius:10px;padding:13px;color:var(--ink)}input[type=range]{width:100%;accent-color:var(--green);cursor:pointer}input[type=checkbox]{accent-color:var(--green);width:20px;height:20px}label{cursor:pointer}.shell{max-width:1120px;margin:auto;padding:34px 28px 48px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:30px}.brand{font-weight:750;letter-spacing:.18em;font-size:17px}.pill{border:1px solid var(--line);border-radius:100px;padding:6px 12px;font-size:14px;color:var(--muted)}.pill.online{color:var(--green)}.layout{display:grid;grid-template-columns:360px 1fr;gap:22px}.card{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:26px}.muted{color:var(--muted)}h1{font-size:28px;margin:0 0 10px;letter-spacing:-.04em}h2{font-size:18px;margin:0}p{margin:8px 0 20px}small{font-size:14px;color:var(--muted)}.angle-card{text-align:center}.circle{width:260px;max-width:100%;margin:8px auto 0;display:block}.big-angle{font-size:38px;font-weight:650;letter-spacing:-.05em}.row{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:12px}.controls{display:grid;gap:20px}.control{padding-bottom:20px;border-bottom:1px solid var(--line)}.control:last-child{padding-bottom:0;border:0}.readout{color:var(--green);font-variant-numeric:tabular-nums;white-space:nowrap}.switch{display:flex;align-items:center;gap:10px}.endpoints{display:flex;justify-content:space-between;font-size:13px;color:var(--muted)}.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:24px}.stat{background:#111713;border-radius:12px;padding:12px}.stat strong{display:block;font-size:26px}.connect{margin-top:22px;display:flex;align-items:center;justify-content:space-between;gap:20px}.connect p{margin:4px 0}.actions{display:flex;gap:10px;flex-wrap:wrap}a.download{display:inline-block;text-decoration:none;text-align:center;padding:11px 16px;background:var(--green);color:#15241b;border-radius:10px;font-weight:650}.login{max-width:440px;margin:9vh auto}.login label{display:block;margin:22px 0 8px}.login button{width:100%;margin-top:16px}.error{color:#ffc3b3;min-height:24px;margin-top:12px;font-size:14px}.save{font-size:14px;color:var(--muted);min-height:24px}footer{display:flex;justify-content:space-between;gap:18px;margin-top:20px;font-size:14px;color:var(--muted)}[hidden]{display:none!important}@media(max-width:760px){.shell{padding:22px 16px}.layout{grid-template-columns:1fr}.card{padding:22px}.angle-card .circle{width:210px}.connect{align-items:stretch;flex-direction:column}.connect .actions{width:100%}.download{flex:1}header{gap:15px}.brand{font-size:14px}.pill{font-size:12px}footer{flex-direction:column;gap:4px}}
</style></head><body><div class="shell"><header><div class="brand">NEVER / CONTROL</div><span id="connection" class="pill">ยังไม่ได้เชื่อมเกม</span></header>
<section id="login" class="card login"><h1>แผงควบคุมของคุณ</h1><p class="muted">ปรับค่าบนเว็บ แล้วสคริปต์ในเกมจะอ่านค่าตาม</p><form id="loginForm"><label for="password">รหัสเข้าเว็บ</label><input id="password" type="password" autocomplete="current-password" required><button class="primary" type="submit">เข้าสู่แผงควบคุม</button><div id="loginError" class="error" role="alert"></div></form></section>
<main id="dashboard" hidden><div class="layout"><section class="card angle-card"><div class="row"><h2>พื้นที่ Head</h2><label class="switch"><input id="headEnabled" type="checkbox" aria-label="เปิดพื้นที่ Head"><span>เปิด</span></label></div>
<svg class="circle" viewBox="0 0 260 260" aria-label="พื้นที่องศาซ้ายและขวาที่เท่ากัน"><circle cx="130" cy="130" r="96" fill="#111713" stroke="#33463b" stroke-width="2"/><path id="sector" fill="#9ee5c9" fill-opacity=".14" stroke="#9ee5c9" stroke-width="2"/><ellipse cx="130" cy="150" rx="45" ry="16" fill="#40584a"/><ellipse cx="130" cy="128" rx="18" ry="24" fill="#769783"/><path d="M124 91l6-9 6 9" fill="none" stroke="#9ee5c9" stroke-width="2"/><text x="130" y="18" text-anchor="middle" fill="#a2b0a6" font-size="12">FRONT / 0°</text><text x="8" y="135" fill="#a2b0a6" font-size="12">L</text><text x="244" y="135" fill="#a2b0a6" font-size="12">R</text><text x="130" y="250" text-anchor="middle" fill="#a2b0a6" font-size="12">180°</text></svg>
<div class="big-angle"><span id="totalAngle">118</span>°</div><small id="sideAngles">ซ้าย 59° / ขวา 59°</small><div class="stats"><div class="stat"><small>พบผู้เล่น</small><strong id="found">—</strong></div><div class="stat"><small>ในบาเรีย</small><strong id="inRange">—</strong></div></div></section>
<section class="card controls"><div class="control"><div class="row"><label for="angle">องศาซ้าย / ขวา</label><output id="angleValue" class="readout">59°</output></div><input id="angle" type="range" min="0" max="180" step="1" value="59"><div class="endpoints"><span>0°</span><span>180° ต่อด้าน</span></div></div>
<div class="control"><div class="row"><h2>Kill Aura</h2><label class="switch"><input id="auraEnabled" type="checkbox"><span>เปิด</span></label></div><small>ส่ง Head ให้ผู้เล่นทุกคนที่อยู่ในระยะในรอบเดียวกัน</small></div>
<div class="control"><div class="row"><label for="radius">ระยะบาเรีย</label><output id="radiusValue" class="readout">20 studs</output></div><input id="radius" type="range" min="0" max="5000" step="1" value="20"><div class="endpoints"><span>0 · หยุดตี</span><span>5000 studs</span></div></div>
<div class="control"><div class="row"><label for="barrierVisible">แสดงบาเรียใส</label><input id="barrierVisible" type="checkbox" checked></div><div class="row"><label for="transparency">ความใส</label><output id="transparencyValue" class="readout">90%</output></div><input id="transparency" type="range" min="0.5" max="0.98" step="0.01" value="0.9"></div>
<div class="control"><div class="row"><label for="interval">รอบการตี</label><output id="intervalValue" class="readout">0.2 วินาที</output></div><input id="interval" type="range" min="0.2" max="2" step="0.1" value="0.2"><div class="endpoints"><span>เร็ว · 0.2 วินาที</span><span>ช้า · 2 วินาที</span></div></div>
<div class="row"><label for="debug">แสดง Arg ใน Output ของเกม</label><input id="debug" type="checkbox"></div><div id="saveStatus" class="save" aria-live="polite">ค่าพร้อมใช้งาน</div></section></div>
<section class="card connect"><div><h2>เชื่อมกับเกม</h2><p class="muted">ดาวน์โหลดสคริปต์จากเว็บนี้แล้วรันในเกมหนึ่งครั้ง</p><small id="gameStatus">รอเกมเชื่อมต่อ</small></div><div class="actions"><a class="download" href="/api/script" download="Never-web.lua">ดาวน์โหลดสคริปต์</a><button id="stop">หยุด Aura</button><button id="reset">คืนค่า</button></div></section>
<footer><span>ซ้ายและขวาขยับพร้อมกัน · ค่าใหม่ส่งถึงเกมประมาณ 1 วินาที</span><button id="logout">ออกจากระบบ</button></footer></main></div>
<script>
const $ = id => document.getElementById(id);
const keys = ['angle','headEnabled','auraEnabled','radius','barrierVisible','transparency','interval','debug'];
const booleans = new Set(['headEnabled','auraEnabled','barrierVisible','debug']);
let authenticated = false, pending = {}, timer, saving = false;
async function api(url, options = {}) {
  const res = await fetch(url, {credentials:'same-origin', ...options, headers:{'Content-Type':'application/json', ...options.headers}});
  const data = await res.json();
  if (!res.ok) {const error = Error(data.error || 'เชื่อมต่อไม่สำเร็จ'); error.status = res.status; throw error;}
  return data;
}
function setAuthenticated(value) {authenticated = value; $('login').hidden = value; $('dashboard').hidden = !value;}
function render() {
  const angle = Number($('angle').value), radius = Number($('radius').value);
  $('angleValue').textContent = angle + '°'; $('totalAngle').textContent = angle * 2;
  $('sideAngles').textContent = 'ซ้าย ' + angle + '° / ขวา ' + angle + '°';
  $('radiusValue').textContent = radius + ' studs';
  $('transparencyValue').textContent = Math.round(Number($('transparency').value)*100) + '%';
  $('intervalValue').textContent = Number($('interval').value).toFixed(1) + ' วินาที';
  const radians = angle*Math.PI/180, r=96, x=Math.sin(radians)*r, y=130-Math.cos(radians)*r;
  $('sector').setAttribute('d', angle===180 ? 'M130 34 A96 96 0 1 1 130 226 A96 96 0 1 1 130 34 Z' : angle===0 ? '' : 'M130 130 L'+(130-x)+' '+y+' A96 96 0 '+(angle>90?1:0)+' 1 '+(130+x)+' '+y+' Z');
  $('sector').style.opacity = $('headEnabled').checked ? 1 : .2;
}
function applyState(data) {
  for (const key of keys) if (!(key in pending) && document.activeElement !== $(key)) {
    if (booleans.has(key)) $(key).checked = data.config[key]; else $(key).value = data.config[key];
  }
  render();
  const device = data.devices.find(d => d.online);
  $('connection').textContent = device ? '● เกมเชื่อมต่อแล้ว' : '○ ยังไม่ได้เชื่อมเกม';
  $('connection').classList.toggle('online', !!device);
  $('found').textContent = device ? device.status.found : '—'; $('inRange').textContent = device ? device.status.inRange : '—';
  $('gameStatus').textContent = device ? device.player + ' · ' + device.status.message + (device.status.hookAvailable ? '' : ' · Hook ไม่พร้อม') : 'ดาวน์โหลดและรันสคริปต์เพื่อเริ่มเชื่อมต่อ';
}
async function refresh() {
  if (saving || Object.keys(pending).length) return;
  try {applyState(await api('/api/state')); setAuthenticated(true);}
  catch (error) {if (error.status===401) setAuthenticated(false); else if(authenticated) $('saveStatus').textContent='เว็บขาดการเชื่อมต่อ';}
}
async function flush() {
  if (saving || !Object.keys(pending).length) return;
  saving = true; const patch = pending; pending = {};
  $('saveStatus').textContent = 'กำลังส่งค่า…';
  try {const data = await api('/api/config', {method:'PATCH',body:JSON.stringify(patch)}); applyState(data); $('saveStatus').textContent='บันทึกแล้ว · เกมจะอ่านค่ารอบถัดไป';}
  catch(error) {pending = {...patch,...pending}; $('saveStatus').textContent = error.message; if(error.status===401)setAuthenticated(false);}
  finally {saving=false; if(authenticated && Object.keys(pending).length) timer=setTimeout(flush,700);}
}
for (const key of keys) $(key).addEventListener('input', () => {pending[key] = booleans.has(key) ? $(key).checked : Number($(key).value); render(); clearTimeout(timer); timer=setTimeout(flush,180);});
$('loginForm').addEventListener('submit', async event => {event.preventDefault(); $('loginError').textContent=''; try {await api('/api/login',{method:'POST',body:JSON.stringify({key:$('password').value})}); $('password').value=''; await refresh();} catch(error){$('loginError').textContent=error.message;}});
$('logout').addEventListener('click', async()=>{await api('/api/logout',{method:'POST',body:'{}'}); pending={};clearTimeout(timer);setAuthenticated(false);});
$('stop').addEventListener('click',()=>{$('auraEnabled').checked=false;pending.auraEnabled=false;clearTimeout(timer);flush();});
$('reset').addEventListener('click',()=>{pending={angle:59,headEnabled:true,auraEnabled:false,radius:20,barrierVisible:true,transparency:.9,interval:.2,debug:false};for(const key of keys) {if(booleans.has(key))$(key).checked=pending[key];else $(key).value=pending[key];}render();clearTimeout(timer);flush();});
render();refresh();setInterval(()=>{if(!document.hidden)refresh();},1500);
</script></body></html>`;

function createApp({adminKey, dataDir, publicURL, secureCookies = false} = {}) {
  if (typeof adminKey !== 'string' || adminKey.length < 24) throw Error('Set ADMIN_KEY to a private passphrase of at least 24 characters');
  const directory = dataDir || path.join(__dirname, 'data');
  fs.mkdirSync(directory, {recursive:true});
  const filename = path.join(directory, 'settings.json');
  let config = {...DEFAULTS}, revision = 0;
  if (fs.existsSync(filename)) {
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
    config = {...DEFAULTS, ...validatePatch(saved.config)};
    revision = Number.isSafeInteger(saved.revision) ? saved.revision : 0;
  }
  const sessions = new Map(), devices = new Map(), attempts = new Map();
  const deviceToken = crypto.createHmac('sha256', adminKey).update('never-device-read-v1').digest('hex');
  const sessionTTL = 86400000;
  const snapshot = () => ({config, revision, devices:[...devices.values()].map(device => ({...device,online:Date.now()-device.lastSeen<10000}))});
  function send(res, code, body, headers = {}) {
    res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }
  async function readBody(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(Error('JSON required'), {code:415});
    let chunks = [], size=0;
    for await (const chunk of req) {size+=chunk.length;if(size>16384)throw Object.assign(Error('Body too large'),{code:413});chunks.push(chunk);}
    try {return JSON.parse(Buffer.concat(chunks).toString() || '{}');} catch {throw Object.assign(Error('Invalid JSON'),{code:400});}
  }
  function authorized(req) {
    const cookie = /(?:^|;\s*)never_session=([a-f0-9]+)/.exec(req.headers.cookie || '');
    if (!cookie) return false;
    const expiry = sessions.get(cookie[1]);
    if (!expiry || expiry < Date.now()) {sessions.delete(cookie[1]);return false;}
    return true;
  }
  function originOf(req) {
    if (publicURL) return new URL(publicURL).origin;
    const host = String(req.headers.host || 'localhost');
    if (!/^[a-zA-Z0-9.:[\]-]+$/.test(host)) throw Object.assign(Error('Invalid host'),{code:400});
    return (secureCookies ? 'https://' : 'http://') + host;
  }
  const app = http.createServer(async (req,res) => {
    try {
      const pathname = new URL(req.url,'http://localhost').pathname;
      const now = Date.now();
      for (const [key, expiry] of sessions) if (expiry<now) sessions.delete(key);
      for (const [key, device] of devices) if (now-device.lastSeen>300000) devices.delete(key);
      for (const [key, attempt] of attempts) if (now-attempt.time>60000) attempts.delete(key);
      if (pathname==='/health' && req.method==='GET') return send(res,200,{ok:true});
      if (pathname==='/' && req.method==='GET') return send(res,200,PAGE,{
        'Content-Type':'text/html; charset=utf-8',
        'Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      if (req.headers.origin && ['POST','PATCH'].includes(req.method) && req.headers.origin!==originOf(req)) return send(res,403,{error:'Origin not allowed'});
      if (pathname==='/api/login' && req.method==='POST') {
        const ip = req.socket.remoteAddress;
        const attempt = attempts.get(ip) || {count:0,time:now};
        if (attempt.count>=10) return send(res,429,{error:'ลองใหม่อีกครั้งในหนึ่งนาที'});
        const body = await readBody(req);
        if (typeof body.key !== 'string' || !sameSecret(body.key,adminKey)) {attempt.count++;attempts.set(ip,attempt);return send(res,401,{error:'รหัสไม่ถูกต้อง'});}
        attempts.delete(ip);
        if (sessions.size>1000) return send(res,429,{error:'Too many sessions'});
        const session = crypto.randomBytes(32).toString('hex');sessions.set(session,now+sessionTTL);
        return send(res,200,{ok:true},{'Set-Cookie':'never_session='+session+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400'+(secureCookies?'; Secure':'')});
      }
      if (pathname==='/api/device/sync' && req.method==='POST') {
        if (!sameSecret(req.headers.authorization || '', 'Bearer '+deviceToken)) return send(res,401,{error:'Unauthorized'});
        const body = await readBody(req);
        if (typeof body.deviceId!=='string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.deviceId)) return send(res,400,{error:'Invalid device'});
        if (!devices.has(body.deviceId) && devices.size>=100) return send(res,429,{error:'Too many devices'});
        const status = body.status || {};
        devices.set(body.deviceId,{deviceId:body.deviceId,player:String(body.player || '').slice(0,64),lastSeen:now,status:{
          found:Number.isFinite(status.found)?Math.max(0,Math.floor(status.found)):0,
          inRange:Number.isFinite(status.inRange)?Math.max(0,Math.floor(status.inRange)):0,
          message:String(status.message || '').slice(0,160),hookAvailable:status.hookAvailable===true,
        }});
        return send(res,200,{config,revision});
      }
      if (!authorized(req)) return send(res,401,{error:'กรุณาเข้าสู่ระบบ'});
      if (pathname==='/api/state' && req.method==='GET') return send(res,200,snapshot());
      if (pathname==='/api/config' && req.method==='PATCH') {
        const patch = validatePatch(await readBody(req));
        const updated = {...config,...patch}, nextRevision=revision+1;
        fs.writeFileSync(filename+'.tmp',JSON.stringify({config:updated,revision:nextRevision},null,2),{mode:0o600});
        fs.renameSync(filename+'.tmp',filename);
        config=updated;revision=nextRevision;
        return send(res,200,snapshot());
      }
      if (pathname==='/api/script' && req.method==='GET') return send(res,200,gameClient(originOf(req),deviceToken),{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="Never-web.lua"'});
      if (pathname==='/api/logout' && req.method==='POST') {
        const cookie = /(?:^|;\s*)never_session=([a-f0-9]+)/.exec(req.headers.cookie || '');if(cookie)sessions.delete(cookie[1]);
        return send(res,200,{ok:true},{'Set-Cookie':'never_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(secureCookies?'; Secure':'')});
      }
      return send(res,404,{error:'Not found'});
    } catch (error) {
      if (!res.headersSent) send(res,error.code || 400,{error:error.message || 'Request failed'});
      else res.end();
    }
  });
  app.requestTimeout=10000;
  return app;
}

async function test() {
  const assert = require('node:assert/strict');
  const os = require('node:os');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'never-web-test-'));
  const key = crypto.randomBytes(32).toString('hex');
  let app=createApp({adminKey:key,dataDir:temp});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  let base='http://127.0.0.1:'+app.address().port;
  try {
    assert.equal((await fetch(base+'/health')).status,200);
    assert.equal((await fetch(base+'/api/state')).status,401);
    assert.equal((await fetch(base+'/api/device/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const headers={'Content-Type':'application/json',Cookie:cookie};
    const patch=await fetch(base+'/api/config',{method:'PATCH',headers,body:JSON.stringify({angle:180,radius:5000,auraEnabled:true})});
    assert.equal(patch.status,200);assert.equal((await patch.json()).config.radius,5000);
    assert.equal((await fetch(base+'/api/config',{method:'PATCH',headers,body:'{"radius":5001}'})).status,400);
    assert.equal((await fetch(base+'/api/config',{method:'PATCH',headers,body:'{"angle":3.5}'})).status,400);
    assert.equal((await fetch(base+'/api/config',{method:'PATCH',headers:{...headers,Origin:'https://elsewhere.example'},body:'{"radius":0}'})).status,403);
    const script=await(await fetch(base+'/api/script',{headers:{Cookie:cookie}})).text();
    assert.ok(script.includes('Event:FireServer(target, "Head")'));assert.ok(script.includes(base));
    const token=crypto.createHmac('sha256',key).update('never-device-read-v1').digest('hex');
    const synced=await fetch(base+'/api/device/sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({deviceId:'test-device',player:'Example',status:{found:3,inRange:2,message:'Ready',hookAvailable:true}})});
    assert.equal(synced.status,200);assert.equal((await synced.json()).config.angle,180);
    const state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.equal(state.devices[0].status.inRange,2);
    await fetch(base+'/api/logout',{method:'POST',headers,body:'{}'});
    assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie}})).status,401);
    await new Promise(resolve=>app.close(resolve));
    app=createApp({adminKey:key,dataDir:temp});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
    base='http://127.0.0.1:'+app.address().port;
    const saved=JSON.parse(fs.readFileSync(path.join(temp,'settings.json'),'utf8'));
    assert.equal(saved.config.radius,5000);assert.equal(saved.config.auraEnabled,true);
    console.log('PASS: login, access controls, validation, CSRF protection, Lua download, device sync, logout, persistence.');
  } finally {
    await new Promise(resolve=>app.close(resolve));
    // Only files created inside this test's verified temporary directory are removed.
    const file=path.join(temp,'settings.json');if(fs.existsSync(file))fs.unlinkSync(file);
    const partial=path.join(temp,'settings.json.tmp');if(fs.existsSync(partial))fs.unlinkSync(partial);
    fs.rmdirSync(temp);
  }
}
if (require.main === module) {
  if (process.argv.includes('--test')) test().catch(error=>{console.error(error);process.exitCode=1;});
  else {
    const app=createApp({adminKey:process.env.ADMIN_KEY,dataDir:process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR,
      publicURL:process.env.PUBLIC_URL,secureCookies:process.env.NODE_ENV==='production' || !!process.env.RAILWAY_ENVIRONMENT_ID});
    app.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Never web server ready'));
  }
}
module.exports={createApp,gameClient,validatePatch};
