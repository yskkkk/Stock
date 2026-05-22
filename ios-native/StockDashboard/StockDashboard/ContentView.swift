import SwiftUI

struct ContentView: View {
    var body: some View {
        StockWebView(url: StockServerConfig.baseURL)
            .ignoresSafeArea()
    }
}
