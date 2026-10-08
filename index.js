  /*
  * NEVER / CONTROL — one-file Railway app; no dependencies.
  * Run: node index.js
  * Railway: set ADMIN_KEY to a private passphrase of at least 8 characters.
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
  function gameClient(baseURL, adminKey) {
    return `-- NEVER web client. Controls live on the website; no in-game panel.
  local WEB_URL = ${JSON.stringify(baseURL)}
  -- KEY belongs to your account and must match your web sign-in key.
  local KEY = ${JSON.stringify(adminKey)}
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
          Headers = {["Content-Type"] = "application/json", Authorization = "Bearer " .. KEY},
          Body = HttpService:JSONEncode({deviceId = deviceId, player = player.Name, status = status})})
      if response and (response.StatusCode == 401 or response.StatusCode == 403) then
          runtime.keyRejected = true
          error("Account key rejected", 0)
      end
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
              if runtime.keyRejected then
                  runtime.connected = false
                  barrier.Visible = false
                  warn("Never: KEY ไม่ถูกต้องหรือถูกปิด กรุณาตรวจสอบกับผู้ดูแล")
                  task.defer(runtime.stop)
                  break
              end
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
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23121316'/%3E%3Cpath d='M18 46V18l28 28V18' fill='none' stroke='%23e2e3e7' stroke-width='6'/%3E%3C/svg%3E">
  <style>
  :root{color-scheme:dark;--bg:#101413;--panel:#191f1c;--line:#303137;--ink:#edf3ec;--muted:#a4a5ad;--green:#e2e3e7}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 'Segoe UI',Tahoma,sans-serif}button,input{font:inherit}button{cursor:pointer;border:1px solid var(--line);background:#222c26;color:var(--ink);border-radius:10px;padding:10px 16px}button:hover{border-color:var(--green)}button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--green);outline-offset:4px}button:disabled{opacity:.45;cursor:wait}.primary{background:var(--green);color:#101114;border-color:var(--green);font-weight:650}input[type=password]{width:100%;background:#0b0c0f;border:1px solid var(--line);border-radius:10px;padding:13px;color:var(--ink)}input[type=range]{width:100%;accent-color:var(--green);cursor:pointer}input[type=checkbox]{accent-color:var(--green);width:20px;height:20px}label{cursor:pointer}.shell{max-width:1120px;margin:auto;padding:34px 28px 48px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:30px}.brand{font-weight:750;letter-spacing:.18em;font-size:17px}.pill{border:1px solid var(--line);border-radius:100px;padding:6px 12px;font-size:14px;color:var(--muted)}.pill.online{color:var(--green)}.layout{display:grid;grid-template-columns:360px 1fr;gap:22px}.card{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:26px}.muted{color:var(--muted)}h1{font-size:28px;margin:0 0 10px;letter-spacing:-.04em}h2{font-size:18px;margin:0}p{margin:8px 0 20px}small{font-size:14px;color:var(--muted)}.angle-card{text-align:center}.circle{width:260px;max-width:100%;margin:8px auto 0;display:block}.big-angle{font-size:38px;font-weight:650;letter-spacing:-.05em}.row{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:12px}.controls{display:grid;gap:20px}.control{padding-bottom:20px;border-bottom:1px solid var(--line)}.control:last-child{padding-bottom:0;border:0}.readout{color:var(--green);font-variant-numeric:tabular-nums;white-space:nowrap}.switch{display:flex;align-items:center;gap:10px}.endpoints{display:flex;justify-content:space-between;font-size:13px;color:var(--muted)}.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:24px}.stat{background:#0b0c0f;border-radius:12px;padding:12px}.stat strong{display:block;font-size:26px}.connect{margin-top:22px;display:flex;align-items:center;justify-content:space-between;gap:20px}.connect p{margin:4px 0}.actions{display:flex;gap:10px;flex-wrap:wrap}a.download{display:inline-block;text-decoration:none;text-align:center;padding:11px 16px;background:var(--green);color:#101114;border-radius:10px;font-weight:650}.login{max-width:440px;margin:9vh auto}.login label{display:block;margin:22px 0 8px}.login button{width:100%;margin-top:16px}.error{color:#ffc3b3;min-height:24px;margin-top:12px;font-size:14px}.save{font-size:14px;color:var(--muted);min-height:24px}footer{display:flex;justify-content:space-between;gap:18px;margin-top:20px;font-size:14px;color:var(--muted)}[hidden]{display:none!important}@media(max-width:760px){.shell{padding:22px 16px}.layout{grid-template-columns:1fr}.card{padding:22px}.angle-card .circle{width:210px}.connect{align-items:stretch;flex-direction:column}.connect .actions{width:100%}.download{flex:1}header{gap:15px}.brand{font-size:14px}.pill{font-size:12px}footer{flex-direction:column;gap:4px}}
  
:root{--bg:#08090b;--panel:#121316;--line:#303137;--ink:#f1f1f3;--muted:#a4a5ad;--green:#e2e3e7}
body{background:var(--bg)}[hidden]{display:none!important}.shell{position:relative;z-index:1}h1,h2,.brand,.big-angle,.readout,.stat strong{font-family:Bahnschrift,'Segoe UI',Tahoma,sans-serif}h1{letter-spacing:.01em}.brand:before{content:'◇';margin-right:12px}.card{position:relative;background:linear-gradient(145deg,#17181ceF,#101114f5);transition:transform 300ms cubic-bezier(.2,.8,.2,1),border-color 300ms,box-shadow 300ms;border-color:rgba(190,192,204,calc(.14 + var(--glow,0)*.35));box-shadow:0 12px 40px #0003}.card:hover{transform:scale(1.02);box-shadow:0 16px 48px #0007}.card:after,button:after,a.download:after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(240px circle at var(--mx,50%) var(--my,50%),#fff2,transparent 70%);opacity:var(--glow,0);transition:opacity 350ms}.card>*{position:relative;z-index:1}button,a.download{position:relative;transition:transform 260ms cubic-bezier(.2,.8,.2,1),background 260ms,border-color 260ms,box-shadow 260ms;background:#202127;color:#eee;border:1px solid #3b3c44}button:hover,a.download:hover{transform:scale(1.04);border-color:#b9bac4;box-shadow:0 0 20px #fff1}.primary,a.download{background:linear-gradient(135deg,#f5f5f7,#bfc1c8);color:#101114;border-color:#ddd}.stat{background:#090a0d;border:1px solid #24252c}.login input,input[type=text]{background:#0b0c0f;border:1px solid #373840;color:#eee;border-radius:10px;padding:12px;width:100%}input{transition:border-color 250ms,box-shadow 250ms}.pill{background:#111216b0}.error{color:#e8b9b9}.ambient{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 50% 0,#33343a50,transparent 65%)}.grid{position:absolute;inset:-80px;background-image:linear-gradient(#ffffff05 1px,transparent 1px),linear-gradient(90deg,#ffffff05 1px,transparent 1px);background-size:64px 64px;animation:gridDrift 28s linear infinite}.particle{position:absolute;width:3px;height:3px;background:#dfdfe8;border-radius:50%;box-shadow:0 0 10px #ffffff60;opacity:.25;animation:float 18s ease-in-out infinite alternate}@keyframes gridDrift{to{transform:translate(64px,64px)}}@keyframes float{to{transform:translate(24px,-85px);opacity:.07}}.paused .ambient *{animation-play-state:paused}.key-manager{margin-top:22px}.key-form{display:flex;gap:12px;margin:20px 0}.key-form input{flex:1;min-width:0}.key-form button{flex:none}.user-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid #292a31}.user-row:last-child{border:0}.user-row{transition:transform 280ms,background 280ms;border-radius:10px}.user-row:hover{transform:scale(1.02);background:#ffffff05}.user-row small{display:block}.key-result{background:#090a0d;padding:16px;border:1px solid #41424b;border-radius:12px;margin:14px 0}.key-result input{font-family:Consolas,monospace;margin:8px 0}.account-info{font-size:13px;color:var(--muted);margin-top:5px}.login{animation:appear 350ms ease-out}@keyframes appear{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@media(max-width:760px){.shell{padding:22px 16px}.key-form{flex-direction:column}.card:hover{transform:scale(1.01)}.user-row{flex-wrap:wrap}.brand{font-size:14px}}@media(prefers-reduced-motion:reduce){.ambient *{animation:none!important}*,*:before,*:after{transition:none!important;animation:none!important}.card:hover,button:hover,a.download:hover{transform:none}}
</style></head><body><div class="ambient" aria-hidden="true"><div class="grid"></div><div id="particles"></div></div><div class="shell"><header><div class="brand">NEVER / CONTROL<div class="account-info" id="accountName">PERSONAL CONTROL</div></div><span id="connection" class="pill">ยังไม่ได้เชื่อมเกม</span></header>
  <section id="login" class="card login"><h1>แผงควบคุมของคุณ</h1><p class="muted">ปรับค่าบนเว็บ แล้วสคริปต์ในเกมจะอ่านค่าตาม</p><form id="loginForm"><label for="password">รหัสเข้าเว็บ</label><input id="password" type="password" autocomplete="current-password" required><button class="primary" type="submit">เข้าสู่แผงควบคุม</button><div id="loginError" class="error" role="alert"></div></form></section>
  <main id="dashboard" hidden><div class="layout"><section class="card angle-card"><div class="row"><h2>พื้นที่ Head</h2><label class="switch"><input id="headEnabled" type="checkbox" aria-label="เปิดพื้นที่ Head"><span>เปิด</span></label></div>
  <svg class="circle" viewBox="0 0 260 260" aria-label="พื้นที่องศาซ้ายและขวาที่เท่ากัน"><circle cx="130" cy="130" r="96" fill="#0b0c0f" stroke="#383a43" stroke-width="2"/><path id="sector" fill="#e2e3e7" fill-opacity=".14" stroke="#e2e3e7" stroke-width="2"/><ellipse cx="130" cy="150" rx="45" ry="16" fill="#555861"/><ellipse cx="130" cy="128" rx="18" ry="24" fill="#a9acb6"/><path d="M124 91l6-9 6 9" fill="none" stroke="#e2e3e7" stroke-width="2"/><text x="130" y="18" text-anchor="middle" fill="#a4a5ad" font-size="12">FRONT / 0°</text><text x="8" y="135" fill="#a4a5ad" font-size="12">L</text><text x="244" y="135" fill="#a4a5ad" font-size="12">R</text><text x="130" y="250" text-anchor="middle" fill="#a4a5ad" font-size="12">180°</text></svg>
  <div class="big-angle"><span id="totalAngle">118</span>°</div><small id="sideAngles">ซ้าย 59° / ขวา 59°</small><div class="stats"><div class="stat"><small>พบผู้เล่น</small><strong id="found">—</strong></div><div class="stat"><small>ในบาเรีย</small><strong id="inRange">—</strong></div></div></section>
  <section class="card controls"><div class="control"><div class="row"><label for="angle">องศาซ้าย / ขวา</label><output id="angleValue" class="readout">59°</output></div><input id="angle" type="range" min="0" max="180" step="1" value="59"><div class="endpoints"><span>0°</span><span>180° ต่อด้าน</span></div></div>
  <div class="control"><div class="row"><h2>Kill Aura</h2><label class="switch"><input id="auraEnabled" type="checkbox"><span>เปิด</span></label></div><small>ส่ง Head ให้ผู้เล่นทุกคนที่อยู่ในระยะในรอบเดียวกัน</small></div>
  <div class="control"><div class="row"><label for="radius">ระยะบาเรีย</label><output id="radiusValue" class="readout">20 studs</output></div><input id="radius" type="range" min="0" max="5000" step="1" value="20"><div class="endpoints"><span>0 · หยุดตี</span><span>5000 studs</span></div></div>
  <div class="control"><div class="row"><label for="barrierVisible">แสดงบาเรียใส</label><input id="barrierVisible" type="checkbox" checked></div><div class="row"><label for="transparency">ความใส</label><output id="transparencyValue" class="readout">90%</output></div><input id="transparency" type="range" min="0.5" max="0.98" step="0.01" value="0.9"></div>
  <div class="control"><div class="row"><label for="interval">รอบการตี</label><output id="intervalValue" class="readout">0.2 วินาที</output></div><input id="interval" type="range" min="0.2" max="2" step="0.1" value="0.2"><div class="endpoints"><span>เร็ว · 0.2 วินาที</span><span>ช้า · 2 วินาที</span></div></div>
  <div class="row"><label for="debug">แสดง Arg ใน Output ของเกม</label><input id="debug" type="checkbox"></div><div id="saveStatus" class="save" aria-live="polite">ค่าพร้อมใช้งาน</div></section></div>
  <section class="card connect"><div><h2>เชื่อมกับเกม</h2><p class="muted">ดาวน์โหลดสคริปต์จากเว็บนี้แล้วรันในเกมหนึ่งครั้ง</p><small id="gameStatus">รอเกมเชื่อมต่อ</small></div><div class="actions"><a class="download" href="/api/script" download="Never-web.lua">ดาวน์โหลดสคริปต์</a><button id="stop">หยุด Aura</button><button id="reset">คืนค่า</button></div></section>
  <section id="keyManager" class="card key-manager" hidden><div class="row"><h2>◇ จัดการ Key / MEMBERS</h2><small>เฉพาะผู้ดูแล</small></div><p class="muted">สร้าง key แยกให้แต่ละคน ค่าควบคุมและสถานะเกมของแต่ละคนแยกกัน</p><form id="newUserForm" class="key-form"><input id="newUserName" type="text" maxlength="64" placeholder="ชื่อสมาชิก" aria-label="ชื่อสมาชิก" required><button class="primary" type="submit">＋ สร้าง Key</button></form><div id="keyResult" class="key-result" hidden><small>คัดลอก key นี้ให้สมาชิก ระบบจะแสดงครั้งเดียว</small><input id="newKey" type="text" readonly aria-label="Key ใหม่"><button id="copyKey" type="button">คัดลอก Key</button></div><div id="keyError" class="error" role="status"></div><div id="usersList"></div></section><footer><span>ซ้ายและขวาขยับพร้อมกัน · ค่าใหม่ส่งถึงเกมประมาณ 1 วินาที</span><button id="logout">ออกจากระบบ</button></footer></main></div>
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
  function setAuthenticated(value) {if(!value){pending={};clearTimeout(timer);$('keyManager').hidden=true;$('newKey').value='';$('keyResult').hidden=true;$('accountName').textContent='PERSONAL CONTROL';}authenticated = value; $('login').hidden = value; $('dashboard').hidden = !value;}
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
    renderAccount(data);
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
  
let userFingerprint='';
function renderAccount(data){
 $('accountName').textContent=(data.account.role==='admin'?'ADMIN · ':'MEMBER · ')+data.account.name;
 $('keyManager').hidden=data.account.role!=='admin';
 const fingerprint=JSON.stringify(data.users||[]);if(fingerprint===userFingerprint)return;userFingerprint=fingerprint;
 $('usersList').replaceChildren();
 for(const user of data.users||[]){const row=document.createElement('div');row.className='user-row';const detail=document.createElement('div');const name=document.createElement('strong');name.textContent=user.name;const sub=document.createElement('small');sub.textContent=(user.disabled?'ปิดใช้งาน':'ใช้งานได้')+' · ออนไลน์ '+user.onlineDevices+' เครื่อง';detail.append(name,sub);const button=document.createElement('button');button.type='button';button.textContent=user.disabled?'เปิด Key':'ปิด Key';button.addEventListener('click',async()=>{button.disabled=true;try{await api('/api/users/'+user.id,{method:'PATCH',body:JSON.stringify({disabled:!user.disabled})});await refresh();}catch(e){$('keyError').textContent=e.message;}finally{button.disabled=false;}});row.append(detail,button);$('usersList').append(row);}
}
$('newUserForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;$('keyError').textContent='';try{const result=await api('/api/users',{method:'POST',body:JSON.stringify({name:$('newUserName').value})});$('newKey').value=result.key;$('keyResult').hidden=false;$('newUserName').value='';await refresh();}catch(e){$('keyError').textContent=e.message;}finally{button.disabled=false;}});
$('copyKey').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('newKey').value);$('keyError').textContent='คัดลอกแล้ว';}catch{$('newKey').focus();$('newKey').select();$('keyError').textContent='เลือก key แล้ว กด Ctrl+C เพื่อคัดลอก';}});
$('logout').addEventListener('click',()=>{$('newKey').value='';$('keyResult').hidden=true;userFingerprint='';});
const particles=$('particles');for(let i=0;i<22;i++){const dot=document.createElement('i');dot.className='particle';dot.style.left=((i*47+13)%100)+'%';dot.style.top=((i*31+7)%100)+'%';dot.style.animationDuration=(16+i%9*3)+'s';dot.style.animationDelay=(-i*1.7)+'s';particles.append(dot);}
let pointerFrame=0,pointerX=0,pointerY=0;const interactive=[...document.querySelectorAll('.card,button,a.download')];
function clearGlow(){for(const el of interactive)el.style.setProperty('--glow',0);}
document.addEventListener('pointermove',event=>{if(event.pointerType==='touch'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;pointerX=event.clientX;pointerY=event.clientY;if(pointerFrame)return;pointerFrame=requestAnimationFrame(()=>{pointerFrame=0;for(const el of interactive){const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;const dx=Math.max(r.left-pointerX,0,pointerX-r.right),dy=Math.max(r.top-pointerY,0,pointerY-r.bottom);const glow=Math.max(0,1-Math.hypot(dx,dy)/90);el.style.setProperty('--glow',glow.toFixed(2));if(glow>0){el.style.setProperty('--mx',(pointerX-r.left)+'px');el.style.setProperty('--my',(pointerY-r.top)+'px');}}});},{passive:true});
document.addEventListener('pointerleave',clearGlow);window.addEventListener('blur',clearGlow);document.addEventListener('visibilitychange',()=>document.body.classList.toggle('paused',document.hidden));

  render();refresh();setInterval(()=>{if(!document.hidden)refresh();},1500);
  </script></body></html>`;

  function createApp({adminKey, dataDir, publicURL, secureCookies=false}={}) {
  adminKey=typeof adminKey==='string'?adminKey.trim():'';
  const configured=adminKey.length>=8;
  const directory=dataDir||path.join(__dirname,'data');fs.mkdirSync(directory,{recursive:true});
  const filename=path.join(directory,'settings.json');
  const accounts=new Map();
  const makeAccount=(saved)=>({...saved,config:{...DEFAULTS,...validatePatch(saved.config||{})},revision:Number.isSafeInteger(saved.revision)?saved.revision:0});
  if(fs.existsSync(filename)) {
    const saved=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(saved.version===2 && Array.isArray(saved.accounts)) for(const account of saved.accounts)accounts.set(account.id,makeAccount(account));
    else accounts.set('admin',makeAccount({id:'admin',name:'ผู้ดูแล',config:saved.config,revision:saved.revision}));
  }
  if(!accounts.has('admin'))accounts.set('admin',makeAccount({id:'admin',name:'ผู้ดูแล'}));
  function persist(){fs.writeFileSync(filename+'.tmp',JSON.stringify({version:2,accounts:[...accounts.values()]},null,2),{mode:0o600});fs.renameSync(filename+'.tmp',filename);}
  const sessions=new Map(),devices=new Map(),attempts=new Map();
  function accountForKey(key){
    if(!configured||typeof key!=='string'||key.length>256)return null;
    if(sameSecret(key,adminKey))return accounts.get('admin');
    const digest=hash(key).toString('hex');
    return [...accounts.values()].find(a=>a.id!=='admin'&&!a.disabled&&typeof a.keyHash==='string'&&sameSecret(a.keyHash,digest))||null;
  }
  function sessionOf(req){const cookie=/(?:^|;\s*)never_session=([a-f0-9]+)/.exec(req.headers.cookie||'');const session=cookie&&sessions.get(cookie[1]);if(!configured||!session||session.expires<Date.now()||!accounts.has(session.accountId)||accounts.get(session.accountId).disabled)return null;return session;}
  function snapshot(account){
    const now=Date.now();const ownDevices=[...devices.values()].filter(d=>d.accountId===account.id).map(({accountId,...d})=>({...d,online:now-d.lastSeen<10000}));
    const result={config:account.config,revision:account.revision,account:{id:account.id,name:account.name,role:account.id==='admin'?'admin':'member'},devices:ownDevices};
    if(account.id==='admin')result.users=[...accounts.values()].filter(a=>a.id!=='admin').map(a=>({id:a.id,name:a.name,disabled:!!a.disabled,onlineDevices:[...devices.values()].filter(d=>d.accountId===a.id&&now-d.lastSeen<10000).length}));
    return result;
  }
  function send(res,code,body,headers={}){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});res.end(typeof body==='string'?body:JSON.stringify(body));}
  async function readBody(req){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Object.assign(Error('JSON required'),{code:415});const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)throw Object.assign(Error('Body too large'),{code:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Error('Invalid JSON');}}
  function originOf(req){if(publicURL)return new URL(publicURL).origin;const host=String(req.headers.host||'localhost');if(!/^[a-zA-Z0-9.:[\]-]+$/.test(host))throw Error('Invalid host');return(secureCookies?'https://':'http://')+host;}
  const setupPage=`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Never / Setup</title><style>body{background:#090a0d;color:#eee;font:17px/1.8 Tahoma,sans-serif;max-width:680px;margin:12vh auto;padding:24px}main{border:1px solid #35363d;background:#141519;padding:30px;border-radius:20px}code{background:#272830;padding:4px 8px;border-radius:6px}h1{font-family:Bahnschrift,sans-serif}p{color:#bbb}</style><main><h1>NEVER / SETUP</h1><p>เว็บเปิดแล้ว แต่ยังไม่ได้ตั้ง key ผู้ดูแล</p><ol><li>เปิด Railway → บริการเว็บนี้ → Variables</li><li>เพิ่ม <code>ADMIN_KEY</code> เป็นรหัสส่วนตัวอย่างน้อย 8 ตัวอักษร แนะนำรหัสยาวที่เดายาก</li><li>กด Deploy เพื่อใช้ค่าใหม่ แล้วกลับมาเข้าเว็บ</li></ol><p>เข้าสู่ระบบด้วย ADMIN_KEY แล้วสร้าง key แยกให้สมาชิกในหน้า “จัดการ Key”</p></main></html>`;
  const app=http.createServer(async(req,res)=>{
    try {
      const pathname=new URL(req.url,'http://localhost').pathname,now=Date.now();
      for(const [id,s]of sessions)if(s.expires<now)sessions.delete(id);
      for(const [id,d]of devices)if(now-d.lastSeen>300000)devices.delete(id);
      for(const [id,a]of attempts)if(now-a.time>60000)attempts.delete(id);
      if(pathname==='/health'&&req.method==='GET')return send(res,200,{ok:true,configured});
      if(pathname==='/'&&req.method==='GET')return send(res,200,configured?PAGE:setupPage,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
      if(req.headers.origin&&['POST','PATCH'].includes(req.method)&&req.headers.origin!==originOf(req))return send(res,403,{error:'Origin not allowed'});
      if(!configured)return send(res,503,{error:'ผู้ดูแลต้องตั้ง ADMIN_KEY ใน Railway Variables อย่างน้อย 8 ตัวอักษร แล้ว Deploy'});
      if(pathname==='/api/login'&&req.method==='POST'){
        const ip=req.socket.remoteAddress,attempt=attempts.get(ip)||{count:0,time:now};
        if(attempt.count>=10)return send(res,429,{error:'ลองใหม่อีกครั้งในหนึ่งนาที'});
        const body=await readBody(req),account=accountForKey(body.key);
        if(!account){attempt.count++;attempts.set(ip,attempt);return send(res,401,{error:'Key ไม่ถูกต้องหรือถูกปิดใช้งาน'});}
        attempts.delete(ip);if(sessions.size>=1000)return send(res,429,{error:'Too many sessions'});
        const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{accountId:account.id,key:body.key,expires:now+86400000});
        return send(res,200,{ok:true},{'Set-Cookie':'never_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400'+(secureCookies?'; Secure':'')});
      }
      if(pathname==='/api/device/sync'&&req.method==='POST'){
        const bearer=/^Bearer (.+)$/.exec(req.headers.authorization||''),account=bearer&&accountForKey(bearer[1]);
        if(!account)return send(res,401,{error:'Key rejected'});
        const body=await readBody(req);if(typeof body.deviceId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(body.deviceId))return send(res,400,{error:'Invalid device'});
        const id=account.id+':'+body.deviceId;if(!devices.has(id)&&[...devices.values()].filter(d=>d.accountId===account.id).length>=100)return send(res,429,{error:'Too many devices'});
        const status=body.status||{};devices.set(id,{accountId:account.id,deviceId:body.deviceId,player:String(body.player||'').slice(0,64),lastSeen:now,status:{found:Number.isFinite(status.found)?Math.max(0,Math.floor(status.found)):0,inRange:Number.isFinite(status.inRange)?Math.max(0,Math.floor(status.inRange)):0,message:String(status.message||'').slice(0,160),hookAvailable:status.hookAvailable===true}});
        return send(res,200,{config:account.config,revision:account.revision});
      }
      const session=sessionOf(req);if(!session)return send(res,401,{error:'กรุณาเข้าสู่ระบบ'});
      const account=accounts.get(session.accountId);
      if(pathname==='/api/state'&&req.method==='GET')return send(res,200,snapshot(account));
      if(pathname==='/api/config'&&req.method==='PATCH'){
        const patch=validatePatch(await readBody(req)),oldConfig=account.config,oldRevision=account.revision;
        account.config={...account.config,...patch};account.revision++;
        try{persist();}catch(e){account.config=oldConfig;account.revision=oldRevision;throw e;}
        return send(res,200,snapshot(account));
      }
      if(pathname==='/api/users'||pathname.startsWith('/api/users/')){
        if(account.id!=='admin')return send(res,403,{error:'เฉพาะผู้ดูแล'});
        if(pathname==='/api/users'&&req.method==='GET')return send(res,200,{users:snapshot(account).users});
        if(pathname==='/api/users'&&req.method==='POST'){
          const body=await readBody(req);if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>64)return send(res,400,{error:'ใส่ชื่อสมาชิก 1–64 ตัวอักษร'});
          if(accounts.size>=501)return send(res,429,{error:'ครบ 500 สมาชิกแล้ว'});
          const key=crypto.randomBytes(32).toString('hex'),id=crypto.randomUUID(),member=makeAccount({id,name:body.name.trim(),keyHash:hash(key).toString('hex'),disabled:false});
          accounts.set(id,member);try{persist();}catch(e){accounts.delete(id);throw e;}
          return send(res,201,{id,name:member.name,key});
        }
        if(pathname.startsWith('/api/users/')&&req.method==='PATCH'){
          const id=pathname.slice('/api/users/'.length),member=accounts.get(id);if(!member||id==='admin')return send(res,404,{error:'ไม่พบสมาชิก'});
          const body=await readBody(req);if(typeof body.disabled!=='boolean')return send(res,400,{error:'Invalid disabled value'});
          const old=member.disabled;member.disabled=body.disabled;try{persist();}catch(e){member.disabled=old;throw e;}
          if(member.disabled){for(const [token,s]of sessions)if(s.accountId===id)sessions.delete(token);for(const [did,d]of devices)if(d.accountId===id)devices.delete(did);}
          return send(res,200,{ok:true});
        }
      }
      if(pathname==='/api/script'&&req.method==='GET')return send(res,200,gameClient(originOf(req),session.key),{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="Never-web.lua"'});
      if(pathname==='/api/logout'&&req.method==='POST'){const cookie=/(?:^|;\s*)never_session=([a-f0-9]+)/.exec(req.headers.cookie||'');if(cookie)sessions.delete(cookie[1]);return send(res,200,{ok:true},{'Set-Cookie':'never_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(secureCookies?'; Secure':'')});}
      return send(res,404,{error:'Not found'});
    }catch(error){if(!res.headersSent)send(res,error.code||400,{error:error.message||'Request failed'});else res.end();}
  });app.requestTimeout=10000;return app;
}

async function test(){
  const assert=require('node:assert/strict'),os=require('node:os');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'never-web-test-'));const key=crypto.randomBytes(32).toString('hex');let app,base;
  async function start(secret){app=createApp({adminKey:secret,dataDir:temp});await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;}
  async function close(){await new Promise(r=>app.close(r));}
  async function call(route,method='GET',body,cookie,token){return fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  async function login(secret){const res=await call('/api/login','POST',{key:secret});assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];}
  try{
    await start();assert.equal((await call('/health')).status,200);assert.equal((await call('/api/login','POST',{key:'anything'})).status,503);assert.ok((await(await call('/')).text()).includes('NEVER / SETUP'));await close();
    fs.writeFileSync(path.join(temp,'settings.json'),JSON.stringify({config:{radius:37},revision:4}));
    await start(key);assert.equal((await call('/api/state')).status,401);assert.equal((await call('/api/login','POST',{key:'incorrect'})).status,401);const admin=await login(key);
    const migrated=await(await call('/api/state','GET',undefined,admin)).json();assert.equal(migrated.config.radius,37);assert.equal(migrated.revision,4);
    const alice=await(await call('/api/users','POST',{name:'Alice'},admin)).json(),bob=await(await call('/api/users','POST',{name:'Bob'},admin)).json();assert.ok(alice.key&&bob.key&&alice.key!==bob.key);
    const a=await login(alice.key),b=await login(bob.key);assert.equal((await call('/api/users','POST',{name:'Unauthorized'},a)).status,403);assert.equal((await call('/api/users','GET',undefined,b)).status,403);
    assert.equal((await call('/api/config','PATCH',{radius:111,auraEnabled:true,angle:180},a)).status,200);
    const bobState=await(await call('/api/state','GET',undefined,b)).json();assert.equal(bobState.config.radius,20);assert.equal(bobState.config.auraEnabled,false);assert.equal(bobState.devices.length,0);assert.ok(!bobState.users);
    const sync=await call('/api/device/sync','POST',{deviceId:'shared-device',player:'Alice',status:{found:3,inRange:2}},undefined,alice.key);assert.equal(sync.status,200);assert.equal((await sync.json()).config.radius,111);
    assert.equal((await(await call('/api/state','GET',undefined,a)).json()).devices.length,1);assert.equal((await(await call('/api/state','GET',undefined,b)).json()).devices.length,0);
    assert.equal((await call('/api/device/sync','POST',{deviceId:'bad'},undefined,'wrong')).status,401);
    assert.equal((await call('/api/config','PATCH',{radius:5001},a)).status,400);assert.equal((await call('/api/config','PATCH',{angle:3.5},a)).status,400);assert.equal((await call('/api/config','PATCH',{auraEnabled:'yes'},a)).status,400);
    assert.equal((await fetch(base+'/api/config',{method:'PATCH',headers:{'Content-Type':'application/json',Cookie:a,Origin:'https://elsewhere.example'},body:'{}'})).status,403);
    const script=await(await call('/api/script','GET',undefined,a)).text();assert.ok(script.includes('local KEY = '+JSON.stringify(alice.key)));assert.ok(!script.includes(key)&&!script.includes(bob.key));
    const page=await(await call('/')).text();const browserScript=page.match(/<script>([\s\S]*?)<\/script>/)[1];new Function(browserScript);for(const id of ['angle','radius','headEnabled','auraEnabled','barrierVisible','transparency','interval','debug','keyManager','particles'])assert.ok(page.includes('id="'+id+'"'));
    assert.equal((await call('/api/users/'+alice.id,'PATCH',{disabled:true},admin)).status,200);assert.equal((await call('/api/state','GET',undefined,a)).status,401);assert.equal((await call('/api/device/sync','POST',{deviceId:'shared-device'},undefined,alice.key)).status,401);assert.equal((await call('/api/state','GET',undefined,b)).status,200);
    const disk=fs.readFileSync(path.join(temp,'settings.json'),'utf8');assert.ok(!disk.includes(alice.key)&&!disk.includes(bob.key)&&!disk.includes(key));
    await close();await start(key);const restoredAdmin=await login(key);const restored=await(await call('/api/state','GET',undefined,restoredAdmin)).json();assert.equal(restored.users.length,2);assert.ok(restored.users.find(u=>u.id===alice.id).disabled);assert.equal((await call('/api/login','POST',{key:alice.key})).status,401);const restoredBob=await login(bob.key);await call('/api/logout','POST',{},restoredBob);assert.equal((await call('/api/state','GET',undefined,restoredBob)).status,401);
    await call('/api/users/'+alice.id,'PATCH',{disabled:false},restoredAdmin);const restoredAlice=await login(alice.key);assert.equal((await(await call('/api/state','GET',undefined,restoredAlice)).json()).config.radius,111);
    console.log('PASS: setup without ADMIN_KEY, independent accounts/config/devices, admin permissions, per-user Lua, revocation, validation, CSRF, persistence, logout, UI controls and browser script syntax.');
  }finally{if(app?.listening)await close();for(const name of ['settings.json','settings.json.tmp']){const file=path.join(temp,name);if(fs.existsSync(file))fs.unlinkSync(file);}fs.rmdirSync(temp);}
}
if(require.main===module){if(process.argv.includes('--test'))test().catch(e=>{console.error(e);process.exitCode=1;});else{const app=createApp({adminKey:process.env.ADMIN_KEY,dataDir:process.env.RAILWAY_VOLUME_MOUNT_PATH||process.env.DATA_DIR,publicURL:process.env.PUBLIC_URL,secureCookies:process.env.NODE_ENV==='production'||!!process.env.RAILWAY_ENVIRONMENT_ID});app.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Never web server ready'+(!process.env.ADMIN_KEY||process.env.ADMIN_KEY.trim().length<8?' — set ADMIN_KEY in Railway Variables':'')));}}
module.exports={createApp,gameClient,validatePatch};
