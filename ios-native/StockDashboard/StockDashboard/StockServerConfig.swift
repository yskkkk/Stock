import Foundation

enum StockServerConfig {
    /// 빌드 시 Info.plist `STOCK_SERVER_URL` (npm run ipa:build)
    static var baseURL: URL {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "STOCK_SERVER_URL") as? String else {
            fatalError("STOCK_SERVER_URL가 Info.plist에 없습니다.")
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed) else {
            fatalError("STOCK_SERVER_URL 형식이 잘못되었습니다: \(raw)")
        }
        return url
    }
}
