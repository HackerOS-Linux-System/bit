package org.hackeros.bitio.ui

import android.net.Uri
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import org.hackeros.bitio.BitApplication

private data class NavTab(val route: String, val label: String, val icon: ImageVector)

private val TABS = listOf(
    NavTab("libraries", "Libraries", Icons.Filled.List),
    NavTab("docs", "Docs", Icons.Filled.Info),
    NavTab("settings", "Settings", Icons.Filled.Settings),
)

@Composable
fun BitApp(app: BitApplication) {
    BitTheme(app.prefs.theme) {
        val nav = rememberNavController()
        val backStack by nav.currentBackStackEntryAsState()
        val route = backStack?.destination?.route

        Scaffold(
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            bottomBar = {
                if (TABS.any { it.route == route }) {
                    NavigationBar {
                        TABS.forEach { t ->
                            NavigationBarItem(
                                selected = route == t.route,
                                onClick = {
                                    nav.navigate(t.route) {
                                        popUpTo("libraries") { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { Icon(t.icon, contentDescription = t.label) },
                                label = { Text(t.label) },
                            )
                        }
                    }
                }
            },
        ) { inner ->
            NavHost(nav, startDestination = "libraries", modifier = Modifier.padding(inner)) {
                composable("libraries") {
                    LibrariesScreen(app.store, onOpen = { nav.navigate("lib/" + Uri.encode(it)) })
                }
                composable("docs") { DocsScreen() }
                composable("settings") { SettingsScreen(app.prefs, app.repo) }
                composable("lib/{name}", arguments = listOf(navArgument("name") { type = NavType.StringType })) { entry ->
                    val name = entry.arguments?.getString("name").orEmpty()
                    LibraryDetailScreen(
                        name = name,
                        store = app.store,
                        repo = app.repo,
                        onBack = { nav.popBackStack() },
                        onOpenLib = { nav.navigate("lib/" + Uri.encode(it)) },
                    )
                }
            }
        }
    }
}
