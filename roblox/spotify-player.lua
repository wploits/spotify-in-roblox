local HttpService = game:GetService("HttpService")
local TweenService = game:GetService("TweenService")

local repo = "https://raw.githubusercontent.com/deividcomsono/Obsidian/main/"
local Library = loadstring(game:HttpGet(repo .. "Library.lua"))()

local httpRequest = request or http_request or (syn and syn.request) or (fluxus and fluxus.request)
assert(httpRequest, "HTTP request function (request / http_request) is not available in this environment.")

local SPOTIFY_GREEN = Color3.fromRGB(30, 215, 96)
local SURFACE_DARK = Color3.fromRGB(22, 22, 26)
local SURFACE_CARD = Color3.fromRGB(30, 30, 36)
local TEXT_MUTED = Color3.fromRGB(170, 170, 180)
local TEXT_BRIGHT = Color3.fromRGB(245, 245, 250)
local LIKE_COLOR = Color3.fromRGB(255, 90, 115)

local Config = {
    BaseUrl = "http://127.0.0.1:8765",
    ApiToken = "",
    PollInterval = 2,
}

local State = {
    CurrentTrackUri = nil,
    CurrentArtworkUri = nil,
    DurationMs = 0,
    ProgressMs = 0,
    IsPlaying = false,
    SuppressCallbacks = false,
    SearchQuery = "",
    SearchResultsMap = {},
    SelectedTrackUri = nil,
}

local function formatTime(ms)
    local totalSec = math.max(0, math.floor((ms or 0) / 1000))
    local m = math.floor(totalSec / 60)
    local s = totalSec % 60
    return string.format("%02d:%02d", m, s)
end

local function buildHeaders(isJson)
    local headers = {}
    if isJson then
        headers["Content-Type"] = "application/json"
    end
    if Config.ApiToken ~= "" then
        headers["Authorization"] = "Bearer " .. Config.ApiToken
    end
    return headers
end

local function apiRequest(method, path, body)
    local ok, res = pcall(httpRequest, {
        Url = Config.BaseUrl .. path,
        Method = method,
        Headers = buildHeaders(body ~= nil),
        Body = body and HttpService:JSONEncode(body) or nil,
    })
    if not ok or not res or not res.Body then
        return nil, "Request failed"
    end
    local decOk, parsed = pcall(HttpService.JSONDecode, HttpService, res.Body)
    if not decOk or type(parsed) ~= "table" then
        return nil, "Invalid JSON"
    end
    if not parsed.ok then
        return parsed, parsed.error or "API error"
    end
    return parsed, nil
end

local function fetchRaw(path)
    local ok, res = pcall(httpRequest, {
        Url = Config.BaseUrl .. path,
        Method = "GET",
        Headers = buildHeaders(false),
    })
    if not ok or not res then
        return nil
    end
    local status = res.StatusCode or (res.Success and 200) or 0
    if status < 200 or status >= 300 or not res.Body or #res.Body == 0 then
        return nil
    end
    return res.Body
end

local function notify(msg, duration)
    pcall(function()
        Library:Notify(msg, duration or 3)
    end)
end

local function findGroupboxContainer(groupbox)
    if typeof(groupbox) == "Instance" then
        return groupbox
    end
    if type(groupbox) ~= "table" then
        return nil
    end
    for _, key in ipairs({ "Container", "Holder", "Box", "Frame", "Content" }) do
        local v = groupbox[key]
        if typeof(v) == "Instance" then
            return v
        end
    end
    for _, v in pairs(groupbox) do
        if typeof(v) == "Instance" and v:FindFirstChildOfClass("UIListLayout") then
            return v
        end
    end
    for _, v in pairs(groupbox) do
        if typeof(v) == "Instance" then
            return v
        end
    end
    return nil
end

local Window = Library:CreateWindow({
    Title = "spotify in roblox",
    Footer = "Spicetify HTTP Bridge",
    NotifySide = "Right",
    ShowCustomCursor = true,
})

local Tabs = {
    Player = Window:AddTab("Player", "music"),
    Settings = Window:AddTab("Settings", "settings"),
}

local NowPlayingBox = Tabs.Player:AddGroupbox({ Side = "Left", Name = "Now Playing" })
local SearchBox = Tabs.Player:AddGroupbox({ Side = "Right", Name = "Search & Queue" })
local SettingsBox = Tabs.Settings:AddGroupbox({ Side = "Left", Name = "Bridge Connection" })

local ArtworkImageLabel = nil
local ProgressFill = nil
local ControlButtons = {}

local function createHeroCard()
    local parentContainer = findGroupboxContainer(NowPlayingBox)
    if not parentContainer then
        return
    end

    pcall(function()
        local card = Instance.new("Frame")
        card.Name = "SpotifyHeroCard"
        card.Size = UDim2.new(1, 0, 0, 152)
        card.BackgroundColor3 = SURFACE_DARK
        card.BorderSizePixel = 0
        card.LayoutOrder = -20
        card.Parent = parentContainer

        local cardCorner = Instance.new("UICorner")
        cardCorner.CornerRadius = UDim.new(0, 8)
        cardCorner.Parent = card

        local cardStroke = Instance.new("UIStroke")
        cardStroke.Color = Color3.fromRGB(48, 48, 56)
        cardStroke.Thickness = 1
        cardStroke.Parent = card

        local artHolder = Instance.new("Frame")
        artHolder.Size = UDim2.fromOffset(128, 128)
        artHolder.Position = UDim2.new(0.5, -64, 0, 8)
        artHolder.BackgroundColor3 = SURFACE_CARD
        artHolder.BorderSizePixel = 0
        artHolder.Parent = card

        local artCorner = Instance.new("UICorner")
        artCorner.CornerRadius = UDim.new(0, 8)
        artCorner.Parent = artHolder

        local artStroke = Instance.new("UIStroke")
        artStroke.Color = SPOTIFY_GREEN
        artStroke.Thickness = 1.5
        artStroke.Transparency = 0.35
        artStroke.Parent = artHolder

        local img = Instance.new("ImageLabel")
        img.Name = "Artwork"
        img.Size = UDim2.fromScale(1, 1)
        img.BackgroundTransparency = 1
        img.ScaleType = Enum.ScaleType.Crop
        img.Parent = artHolder

        local imgCorner = Instance.new("UICorner")
        imgCorner.CornerRadius = UDim.new(0, 8)
        imgCorner.Parent = img

        local barBg = Instance.new("Frame")
        barBg.Size = UDim2.new(1, -16, 0, 4)
        barBg.Position = UDim2.new(0, 8, 1, -8)
        barBg.BackgroundColor3 = Color3.fromRGB(52, 52, 60)
        barBg.BorderSizePixel = 0
        barBg.Parent = card

        local barBgCorner = Instance.new("UICorner")
        barBgCorner.CornerRadius = UDim.new(1, 0)
        barBgCorner.Parent = barBg

        local barFill = Instance.new("Frame")
        barFill.Size = UDim2.new(0, 0, 1, 0)
        barFill.BackgroundColor3 = SPOTIFY_GREEN
        barFill.BorderSizePixel = 0
        barFill.Parent = barBg

        local barFillCorner = Instance.new("UICorner")
        barFillCorner.CornerRadius = UDim.new(1, 0)
        barFillCorner.Parent = barFill

        ArtworkImageLabel = img
        ProgressFill = barFill
    end)
end

local function createControlBar()
    local parentContainer = findGroupboxContainer(NowPlayingBox)
    if not parentContainer then
        return false
    end

    local created = false
    pcall(function()
        local bar = Instance.new("Frame")
        bar.Name = "SpotifyControlBar"
        bar.Size = UDim2.new(1, 0, 0, 40)
        bar.BackgroundTransparency = 1
        bar.LayoutOrder = -5
        bar.Parent = parentContainer

        local layout = Instance.new("UIListLayout")
        layout.FillDirection = Enum.FillDirection.Horizontal
        layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
        layout.VerticalAlignment = Enum.VerticalAlignment.Center
        layout.Padding = UDim.new(0, 8)
        layout.Parent = bar

        local function makeBtn(key, text, size, bgColor, textColor, callback)
            local btn = Instance.new("TextButton")
            btn.Name = key
            btn.Size = UDim2.fromOffset(size, size)
            btn.BackgroundColor3 = bgColor
            btn.BorderSizePixel = 0
            btn.Text = text
            btn.TextColor3 = textColor
            btn.Font = Enum.Font.GothamBold
            btn.TextSize = size >= 36 and 16 or 14
            btn.AutoButtonColor = false
            btn.Parent = bar

            local corner = Instance.new("UICorner")
            corner.CornerRadius = UDim.new(1, 0)
            corner.Parent = btn

            btn.MouseEnter:Connect(function()
                TweenService:Create(btn, TweenInfo.new(0.12), { BackgroundTransparency = 0.15 }):Play()
            end)
            btn.MouseLeave:Connect(function()
                TweenService:Create(btn, TweenInfo.new(0.12), { BackgroundTransparency = 0 }):Play()
            end)
            btn.MouseButton1Click:Connect(callback)

            ControlButtons[key] = btn
            return btn
        end

        makeBtn("Shuffle", "🔀", 30, SURFACE_CARD, TEXT_MUTED, function()
            local res, err = apiRequest("POST", "/shuffle")
            if err then notify("Error: " .. err) end
            if res and res.data and ControlButtons.Shuffle then
                ControlButtons.Shuffle.TextColor3 = res.data.shuffle and SPOTIFY_GREEN or TEXT_MUTED
            end
        end)

        makeBtn("Prev", "⏮", 32, SURFACE_CARD, TEXT_BRIGHT, function()
            local _, err = apiRequest("POST", "/prev")
            if err then notify("Error: " .. err) end
        end)

        makeBtn("PlayPause", "▶", 38, SPOTIFY_GREEN, Color3.fromRGB(12, 12, 14), function()
            local res, err = apiRequest("POST", "/toggle")
            if err then notify("Error: " .. err) end
            if res and res.data and ControlButtons.PlayPause then
                ControlButtons.PlayPause.Text = res.data.isPlaying and "⏸" or "▶"
            end
        end)

        makeBtn("Next", "⏭", 32, SURFACE_CARD, TEXT_BRIGHT, function()
            local _, err = apiRequest("POST", "/next")
            if err then notify("Error: " .. err) end
        end)

        makeBtn("Repeat", "🔁", 30, SURFACE_CARD, TEXT_MUTED, function()
            local res, err = apiRequest("POST", "/repeat")
            if err then notify("Error: " .. err) end
            if res and res.data and ControlButtons.Repeat then
                local mode = res.data["repeat"] or 0
                ControlButtons.Repeat.Text = mode == 2 and "🔂" or "🔁"
                ControlButtons.Repeat.TextColor3 = mode > 0 and SPOTIFY_GREEN or TEXT_MUTED
            end
        end)

        makeBtn("Like", "♥", 30, SURFACE_CARD, TEXT_MUTED, function()
            local res, err = apiRequest("POST", "/like")
            if err then notify("Error: " .. err) end
            if res and res.data and ControlButtons.Like then
                ControlButtons.Like.TextColor3 = res.data.liked and LIKE_COLOR or TEXT_MUTED
            end
        end)

        created = true
    end)
    return created
end

createHeroCard()
local TrackLabel = NowPlayingBox:AddLabel("Connecting to Spotify...", true)
local TimeLabel = NowPlayingBox:AddLabel("00:00 / 00:00", true)
local hasCustomBar = createControlBar()

if not hasCustomBar then
    NowPlayingBox:AddButton({
        Text = "Play / Pause",
        Func = function()
            local _, err = apiRequest("POST", "/toggle")
            if err then notify("Error: " .. err) end
        end,
    })
    NowPlayingBox:AddButton({
        Text = "Next Track",
        Func = function()
            local _, err = apiRequest("POST", "/next")
            if err then notify("Error: " .. err) end
        end,
    })
    NowPlayingBox:AddButton({
        Text = "Previous Track",
        Func = function()
            local _, err = apiRequest("POST", "/prev")
            if err then notify("Error: " .. err) end
        end,
    })
    NowPlayingBox:AddButton({
        Text = "Toggle Like",
        Func = function()
            local _, err = apiRequest("POST", "/like")
            if err then notify("Error: " .. err) end
        end,
    })
end

NowPlayingBox:AddDivider()

local SeekSlider = NowPlayingBox:AddSlider("SeekSlider", {
    Text = "Seek",
    Default = 0,
    Min = 0,
    Max = 300,
    Decimals = 0,
    Suffix = "s",
    Callback = function(val)
        if State.SuppressCallbacks then return end
        apiRequest("POST", "/seek", { seconds = val })
    end,
})

local VolumeSlider = NowPlayingBox:AddSlider("VolumeSlider", {
    Text = "Volume",
    Default = 50,
    Min = 0,
    Max = 100,
    Decimals = 0,
    Suffix = "%",
    Callback = function(val)
        if State.SuppressCallbacks then return end
        apiRequest("POST", "/volume", { volume = val })
    end,
})

SearchBox:AddInput("SearchQueryInput", {
    Default = "",
    Numeric = false,
    Finished = true,
    Text = "Search",
    Placeholder = "Song or artist name...",
    Callback = function(val)
        State.SearchQuery = val or ""
    end,
})

local ResultDropdown = SearchBox:AddDropdown("SearchResultDropdown", {
    Values = { "(No search results)" },
    Default = 1,
    Multi = false,
    Text = "Results",
    Callback = function(selected)
        State.SelectedTrackUri = State.SearchResultsMap[selected]
    end,
})

local function runSearch()
    if State.SearchQuery == "" then
        notify("Enter a search query first.", 2)
        return
    end
    local encoded = HttpService:UrlEncode(State.SearchQuery)
    local res, err = apiRequest("GET", "/search?q=" .. encoded .. "&limit=10")
    if err or not res or not res.data or not res.data.tracks or #res.data.tracks == 0 then
        notify("No tracks found" .. (err and (": " .. err) or ""), 3)
        return
    end

    State.SearchResultsMap = {}
    local labels = {}
    for i, t in ipairs(res.data.tracks) do
        local artistText = type(t.artists) == "table" and table.concat(t.artists, ", ") or ""
        local label = string.format("%d. %s - %s", i, t.name or "Unknown", artistText)
        State.SearchResultsMap[label] = t.uri
        table.insert(labels, label)
    end
    State.SelectedTrackUri = res.data.tracks[1].uri
    ResultDropdown:SetValues(labels)
    ResultDropdown:SetValue(labels[1])
    notify("Found " .. #labels .. " tracks", 2)
end

SearchBox:AddButton({
    Text = "Search Tracks",
    Func = runSearch,
})

SearchBox:AddButton({
    Text = "Play Selected",
    Func = function()
        if not State.SelectedTrackUri then
            notify("Select a track first.", 2)
            return
        end
        local _, err = apiRequest("POST", "/play", { uri = State.SelectedTrackUri })
        if err then notify("Error: " .. err) end
    end,
})

SearchBox:AddButton({
    Text = "Add Selected to Queue",
    Func = function()
        if not State.SelectedTrackUri then
            notify("Select a track first.", 2)
            return
        end
        local _, err = apiRequest("POST", "/queue/add", { uri = State.SelectedTrackUri })
        if err then
            notify("Error: " .. err)
        else
            notify("Added to queue!", 2)
        end
    end,
})

SearchBox:AddButton({
    Text = "Play First Match",
    Func = function()
        if State.SearchQuery == "" then
            notify("Enter a search query first.", 2)
            return
        end
        local res, err = apiRequest("POST", "/play", { query = State.SearchQuery })
        if err then
            notify("Error: " .. err)
        elseif res and res.data and res.data.matched then
            notify("Playing: " .. (res.data.matched.name or "Track"), 3)
        end
    end,
})

SearchBox:AddDivider()
local QueueLabel = SearchBox:AddLabel("Up Next: (Loading...)", true)

local function refreshQueue()
    local res, err = apiRequest("GET", "/queue")
    if err or not res or not res.data then
        QueueLabel:SetText("Queue unavailable")
        return
    end
    local lines = {}
    for i, t in ipairs(res.data.nextTracks or {}) do
        if i > 6 then break end
        table.insert(lines, string.format("%d. %s - %s", i, t.name or "?", t.artistNames or "?"))
    end
    if #lines == 0 then
        QueueLabel:SetText("Queue is empty")
    else
        QueueLabel:SetText("Up Next:\n" .. table.concat(lines, "\n"))
    end
end

SearchBox:AddButton({
    Text = "Refresh Queue",
    Func = refreshQueue,
})

SettingsBox:AddInput("BridgeUrlInput", {
    Default = Config.BaseUrl,
    Numeric = false,
    Finished = true,
    Text = "Bridge URL",
    Placeholder = "http://127.0.0.1:8765",
    Callback = function(val)
        if val and val ~= "" then
            Config.BaseUrl = val:gsub("/+$", "")
        end
    end,
})

SettingsBox:AddInput("ApiTokenInput", {
    Default = "",
    Numeric = false,
    Finished = true,
    Text = "API Token (Optional)",
    Placeholder = "Bearer token",
    Callback = function(val)
        Config.ApiToken = val or ""
    end,
})

SettingsBox:AddSlider("PollIntervalSlider", {
    Text = "Refresh Interval",
    Default = 2,
    Min = 1,
    Max = 10,
    Decimals = 0,
    Suffix = "s",
    Callback = function(val)
        Config.PollInterval = math.max(1, val)
    end,
})

SettingsBox:AddButton({
    Text = "Unload",
    Func = function()
        Library:Unload()
    end,
})

local function updateArtwork(trackUri)
    if not ArtworkImageLabel or not trackUri then return end
    if type(writefile) ~= "function" or type(getcustomasset) ~= "function" then return end
    if State.CurrentArtworkUri == trackUri then return end
    State.CurrentArtworkUri = trackUri

    task.spawn(function()
        local bytes = fetchRaw("/artwork")
        if not bytes then return end
        pcall(function()
            local filename = "spotify_in_roblox_cover.jpg"
            writefile(filename, bytes)
            ArtworkImageLabel.Image = getcustomasset(filename)
        end)
    end)
end

task.spawn(function()
    while not Library.Unloaded do
        local res, err = apiRequest("GET", "/now-playing")
        if res and res.ok and res.data then
            local d = res.data
            local t = d.track
            if t then
                local statusIcon = d.isPlaying and "▶ Playing" or "⏸ Paused"
                local albumName = (t.album and t.album.name) or "-"
                TrackLabel:SetText(string.format(
                    "%s%s\n%s\n%s\nAlbum: %s",
                    statusIcon,
                    d.liked and "  ♥" or "",
                    t.name or "Unknown",
                    t.artistNames or "Unknown",
                    albumName
                ))
                TimeLabel:SetText(string.format("%s / %s", formatTime(d.progressMs), formatTime(d.durationMs)))

                if ProgressFill and d.durationMs and d.durationMs > 0 then
                    local ratio = math.clamp((d.progressMs or 0) / d.durationMs, 0, 1)
                    pcall(function()
                        TweenService:Create(ProgressFill, TweenInfo.new(0.25), {
                            Size = UDim2.new(ratio, 0, 1, 0),
                        }):Play()
                    end)
                end

                if ControlButtons.PlayPause then
                    ControlButtons.PlayPause.Text = d.isPlaying and "⏸" or "▶"
                end
                if ControlButtons.Shuffle then
                    ControlButtons.Shuffle.TextColor3 = d.shuffle and SPOTIFY_GREEN or TEXT_MUTED
                end
                if ControlButtons.Repeat then
                    local rep = d["repeat"] or 0
                    ControlButtons.Repeat.Text = rep == 2 and "🔂" or "🔁"
                    ControlButtons.Repeat.TextColor3 = rep > 0 and SPOTIFY_GREEN or TEXT_MUTED
                end
                if ControlButtons.Like then
                    ControlButtons.Like.TextColor3 = d.liked and LIKE_COLOR or TEXT_MUTED
                end

                State.SuppressCallbacks = true
                pcall(function()
                    local maxSec = math.max(1, math.floor((d.durationMs or 0) / 1000))
                    if SeekSlider.Max ~= maxSec and SeekSlider.SetMax then
                        SeekSlider:SetMax(maxSec)
                    end
                    SeekSlider:SetValue(math.floor((d.progressMs or 0) / 1000))
                    if type(d.volume) == "number" then
                        VolumeSlider:SetValue(d.volume)
                    end
                end)
                State.SuppressCallbacks = false

                if t.uri ~= State.CurrentTrackUri then
                    State.CurrentTrackUri = t.uri
                    updateArtwork(t.uri)
                    task.spawn(refreshQueue)
                end
            else
                TrackLabel:SetText("Nothing playing")
                TimeLabel:SetText("00:00 / 00:00")
            end
        else
            TrackLabel:SetText("Bridge / Spotify offline\n" .. tostring(err or ""))
        end
        task.wait(Config.PollInterval)
    end
end)

Library:SetWatermark("spotify in roblox")
Window:Center()
