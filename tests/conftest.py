import shutil

import pytest

from clipforge.config import Settings

requires_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, provider_mode="fake", asset_root=tmp_path / "assets", x264_preset="ultrafast",
                    embedded_worker=False, public_api_url="http://testserver")


@pytest.fixture
async def app(settings):
    from clipforge.orchestrator import create_app_state

    a = await create_app_state(settings)
    yield a
    await a.aclose()
