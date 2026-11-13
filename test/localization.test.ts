import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { translate, t } from "../src/i18n";
import { french } from "../src/i18n/fr";

describe("French localization", () => {
    it("preserves English and falls back for other languages and missing keys", () => {
        const key = Object.keys(french)[0];
        assert.equal(translate("en", key), key);
        assert.equal(translate("de", key), key);
        assert.equal(translate("fr", "Untranslated message"), "Untranslated message");
        assert.equal(translate("fr", "toString"), "toString");
    });
    it("supports French language variants", () => {
        const key = Object.keys(french)[0];
        for (const language of ["fr", "fr-FR", "fr-CH", "fr_CA"]) {
            assert.equal(translate(language, key), french[key]);
        }
    });
    it("keeps interpolation tokens and inserted user text intact", () => {
        for (const [key, value] of Object.entries(french)) {
            assert.deepEqual((value.match(/\{\d+\}/g) || []).sort(), (key.match(/\{\d+\}/g) || []).sort());
        }
        assert.equal(translate("en", "{0} then {1}", "$&{1}", "<note>"), "$&{1} then <note>");
        assert.equal(t`Hello ${"{0}$&"}`, "Hello {0}$&");
    });
});
