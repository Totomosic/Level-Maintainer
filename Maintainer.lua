local ae2 = require("src.AE2")
local cfg = require("config")
local util = require("src.Utility")

local items = cfg.items or {}
local sleepInterval = tonumber(cfg.sleep) or 10
local configUrl = cfg.config_url

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

local function countItems(list)
    local count = 0
    for _ in pairs(list) do
        count = count + 1
    end
    return count
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
        config_url = parsed.config_url
    }
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
    lastRemoteConfigRaw = body
    logInfo("Remote config updated: " .. tostring(countItems(items)) .. " items, sleep=" .. tostring(sleepInterval))
end

pollRemoteConfig(true)

while true do
    pollRemoteConfig(false)
    local itemsCrafting = ae2.checkIfCrafting()

    for item, config in pairs(items) do
        if itemsCrafting[item] == true then
            logInfo(item .. " is already being crafted, skipping...")
        else
            local success, answer = ae2.requestItem(item, config[1], config[2], config[3])
            logInfo(answer)
        end

    end
    os.sleep(sleepInterval)
end
