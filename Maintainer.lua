local ae2 = require("src.AE2")
local cfg = require("config")
local util = require("src.Utility")

local items = cfg.items or {}
local sleepInterval = tonumber(cfg.sleep) or 10
local configUrl = cfg.config_url
local ignoredCrafts = cfg.ignored_crafts or {}

local internet = nil
if type(configUrl) == "string" and configUrl ~= "" then
    local ok, internetLib = pcall(require, "internet")
    if ok then
        internet = internetLib
    else
        logInfo("config_url is set, but internet component is not available: " .. tostring(internetLib))
    end
end

local CONFIG_POLL_INTERVAL = 60
local nextConfigPoll = 0
local lastRemoteConfigRaw = nil
local LOW_PRIORITY_MAX_CRAFTING = 10

local function countItems(list)
    local count = 0
    for _ in pairs(list) do
        count = count + 1
    end
    return count
end

local function normalizeIgnoredCrafts(rawList)
    if type(rawList) ~= "table" then
        return {}
    end

    local normalized = {}
    for _, pattern in pairs(rawList) do
        if type(pattern) == "string" then
            local trimmed = string.match(pattern, "^%s*(.-)%s*$")
            if trimmed ~= nil and trimmed ~= "" then
                normalized[#normalized + 1] = string.lower(trimmed)
            end
        end
    end

    return normalized
end

local function isIgnoredCraftName(craftName, ignoredPatterns)
    if type(craftName) ~= "string" then
        return false
    end

    local loweredName = string.lower(craftName)
    for _, pattern in ipairs(ignoredPatterns) do
        if string.find(loweredName, pattern, 1, true) ~= nil then
            return true
        end
    end

    return false
end

local function parseConfigString(rawConfig, sourceName)
    local chunk, loadErr = load(rawConfig, "=" .. sourceName, "t", {})
    if not chunk then
        return nil, "could not parse config: " .. tostring(loadErr)
    end

    local ok, parsed = pcall(chunk)
    if not ok then
        return nil, "could not execute config: " .. tostring(parsed)
    end

    if type(parsed) ~= "table" then
        return nil, "config did not return a table"
    end

    if type(parsed.items) ~= "table" then
        return nil, "config.items is missing or invalid"
    end

    local parsedSleep = tonumber(parsed.sleep)
    if parsedSleep == nil then
        return nil, "config.sleep is missing or invalid"
    end

    if parsedSleep < 0 then
        return nil, "config.sleep must be >= 0"
    end

    return {
        items = parsed.items,
        sleep = math.floor(parsedSleep + 0),
        config_url = parsed.config_url,
        ignored_crafts = normalizeIgnoredCrafts(parsed.ignored_crafts)
    }
end

local function resolvePriority(rawPriority)
    if type(rawPriority) ~= "string" then
        return "standard"
    end

    local normalized = string.lower(rawPriority)
    if normalized == "low" then
        return "low"
    end

    return "standard"
end

local function getCraftingState(itemsCrafting, configuredItems, ignoredPatterns)
    local activeCraftingCount = 0
    local hasExternalCrafting = false

    for craftingItem in pairs(itemsCrafting) do
        activeCraftingCount = activeCraftingCount + 1
        if configuredItems[craftingItem] == nil and not isIgnoredCraftName(craftingItem, ignoredPatterns) then
            hasExternalCrafting = true
        end
    end

    return activeCraftingCount, hasExternalCrafting
end

local function fetchRemoteConfigBody(url)
    if not internet then
        return nil, "internet library unavailable"
    end

    local request, requestErr = internet.request(url)
    if not request then
        return nil, requestErr or "request failed"
    end

    local ok, bodyOrErr = pcall(function()
        local chunks = {}
        for chunk in request do
            chunks[#chunks + 1] = chunk
        end
        return table.concat(chunks)
    end)

    if not ok then
        return nil, bodyOrErr
    end

    if type(bodyOrErr) ~= "string" or bodyOrErr == "" then
        return nil, "empty response body"
    end

    return bodyOrErr
end

local function pollRemoteConfig(force)
    if type(configUrl) ~= "string" or configUrl == "" then
        return
    end

    local now = os.time()
    if not force and now < nextConfigPoll then
        return
    end
    nextConfigPoll = now + CONFIG_POLL_INTERVAL

    local body, fetchErr = fetchRemoteConfigBody(configUrl)
    if not body then
        logInfo("Remote config fetch failed: " .. tostring(fetchErr))
        return
    end

    if body == lastRemoteConfigRaw then
        return
    end

    local parsed, parseErr = parseConfigString(body, "remote_config")
    if not parsed then
        logInfo("Remote config rejected: " .. tostring(parseErr))
        return
    end

    items = parsed.items
    sleepInterval = parsed.sleep
    ignoredCrafts = parsed.ignored_crafts or {}
    lastRemoteConfigRaw = body
    logInfo("Remote config updated: " .. tostring(countItems(items)) .. " items, sleep=" .. tostring(sleepInterval))
end

ignoredCrafts = normalizeIgnoredCrafts(ignoredCrafts)
pollRemoteConfig(true)

while true do
    pollRemoteConfig(false)
    local itemsCrafting = ae2.checkIfCrafting()
    local activeCraftingCount, hasExternalCrafting = getCraftingState(itemsCrafting, items, ignoredCrafts)

    for item, config in pairs(items) do
        if type(config) ~= "table" then
            logInfo("Invalid config for " .. tostring(item) .. ", expected table, skipping...")
        elseif itemsCrafting[item] == true then
            logInfo(item .. " is already being crafted, skipping...")
        else
            local priority = resolvePriority(config[4])
            local shouldRequest = true

            if priority == "low" then
                if activeCraftingCount >= LOW_PRIORITY_MAX_CRAFTING then
                    shouldRequest = false
                    logInfo(
                        "Skipping low priority item " .. item .. ": "
                        .. tostring(activeCraftingCount)
                        .. " crafts in progress (limit "
                        .. tostring(LOW_PRIORITY_MAX_CRAFTING - 1)
                        .. ")."
                    )
                elseif hasExternalCrafting then
                    shouldRequest = false
                    logInfo("Skipping low priority item " .. item .. ": external (non-maintainer) crafts are active.")
                end
            end

            if shouldRequest then
                local success, answer = ae2.requestItem(item, config[1], config[2], config[3])
                logInfo(answer)

                if success and itemsCrafting[item] ~= true then
                    itemsCrafting[item] = true
                    activeCraftingCount = activeCraftingCount + 1
                end
            end
        end

    end
    os.sleep(sleepInterval)
end
