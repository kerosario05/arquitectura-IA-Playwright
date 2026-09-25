"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLoginStrategy = getLoginStrategy;
const manual_login_strategy_1 = require("./manual-login.strategy");
const no_login_strategy_1 = require("./no-login.strategy");
const password_login_strategy_1 = require("./password-login.strategy");
function getLoginStrategy(loginMode) {
    switch (loginMode) {
        case "password":
            return password_login_strategy_1.passwordLoginStrategy;
        case "no_login":
            return no_login_strategy_1.noLoginStrategy;
        case "manual":
            return manual_login_strategy_1.manualLoginStrategy;
        default:
            throw new Error(`Unsupported login mode: ${loginMode}`);
    }
}
